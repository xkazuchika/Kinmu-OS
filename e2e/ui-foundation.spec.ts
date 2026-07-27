import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const owner = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner.ui-test@example.com",
  password: process.env.E2E_OWNER_PASSWORD ?? "OwnerUiTest-2026!",
};
const runId = `${Date.now().toString(36)}-${process.pid}`;
const employee = {
  email: `employee.ui-test+${runId}@example.com`,
  employeeNumber: `E2E-${runId}`,
  password: "EmployeeUiTest-2026!",
};
const hrAdmin = {
  email: "hr.ui-test@example.com",
  password: "HrUiTest-2026!",
};
const approver = {
  email: "approver.ui-test@example.com",
  password: "ApproverUiTest-2026!",
};
let loginSequence = 10;

async function activate(request: APIRequestContext, setupUrl: string, password: string) {
  const token = setupUrl.split("/").at(-1);
  const response = await request.post("/api/activate", { data: { password, token } });
  expect(response.ok()).toBe(true);
}

async function prepareAccounts(request: APIRequestContext) {
  const setup = await request.post("/api/setup", {
    data: {
      organizationName: "UI検証株式会社",
      ownerEmail: owner.email,
      ownerName: "管理 太郎",
      timezone: "Asia/Tokyo",
    },
  });

  if (setup.status() === 201) {
    const body = (await setup.json()) as { setupUrl: string };
    await activate(request, body.setupUrl, owner.password);
  } else {
    const login = await request.post("/api/auth/login", {
      data: { email: owner.email, password: owner.password },
    });
    expect(login.ok()).toBe(true);
  }

  async function ensureUser(
    account: { email: string; password: string },
    displayName: string,
    role: "approver" | "hr_admin" | "employee",
  ) {
    const usersResponse = await request.get("/api/users");
    expect(usersResponse.ok()).toBe(true);
    const { users } = (await usersResponse.json()) as { users: Array<{ email: string }> };
    if (users.some((user) => user.email === account.email)) return;
    const created = await request.post("/api/users", {
      data: { displayName, email: account.email, role },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { setupUrl: string };
    await activate(request, body.setupUrl, account.password);
    const login = await request.post("/api/auth/login", {
      data: { email: owner.email, password: owner.password },
    });
    expect(login.ok()).toBe(true);
  }

  await ensureUser(hrAdmin, "労務 管理子", "hr_admin");
  await ensureUser(approver, "承認 担当子", "approver");
  await ensureUser(employee, "従業員 花子", "employee");

  const usersResponse = await request.get("/api/users");
  const { users } = (await usersResponse.json()) as {
    users: Array<{ email: string; id: string }>;
  };
  const employeeUser = users.find((user) => user.email === employee.email);
  expect(employeeUser).toBeTruthy();

  const departmentsResponse = await request.get("/api/departments");
  expect(departmentsResponse.ok()).toBe(true);
  let { departments } = (await departmentsResponse.json()) as {
    departments: Array<{ code: string; id: string }>;
  };
  if (!departments.some((department) => department.code === "UI-TEST")) {
    const created = await request.post("/api/departments", {
      data: { code: "UI-TEST", name: "UI検証部" },
    });
    expect(created.status()).toBe(201);
    departments = [
      ...departments,
      ((await created.json()) as { department: { code: string; id: string } }).department,
    ];
  }
  const department = departments.find((item) => item.code === "UI-TEST");
  expect(department).toBeTruthy();

  const employeesResponse = await request.get("/api/employees");
  expect(employeesResponse.ok()).toBe(true);
  let { employees } = (await employeesResponse.json()) as {
    employees: Array<{ employeeNumber: string; id: string }>;
  };
  if (!employees.some((record) => record.employeeNumber === employee.employeeNumber)) {
    const created = await request.post("/api/employees", {
      data: {
        contactEmail: employee.email,
        departmentId: department!.id,
        displayName: "従業員 花子",
        employeeNumber: employee.employeeNumber,
        employmentType: "full_time",
        familyName: "従業員",
        givenName: "花子",
        joinedOn: "2026-01-01",
        status: "active",
      },
    });
    expect(created.status()).toBe(201);
    employees = [
      ...employees,
      ((await created.json()) as { employee: { employeeNumber: string; id: string } }).employee,
    ];
  }
  const employeeRecord = employees.find(
    (record) => record.employeeNumber === employee.employeeNumber,
  );
  const linked = await request.patch(`/api/employees/${employeeRecord!.id}`, {
    data: {
      contactEmail: employee.email,
      departmentEffectiveOn: "2026-07-15",
      departmentId: department!.id,
      displayName: "従業員 花子",
      employmentType: "full_time",
      familyName: "従業員",
      givenName: "花子",
      phoneNumber: "",
      userId: employeeUser!.id,
    },
  });
  expect(linked.ok()).toBe(true);

  const rulesResponse = await request.get("/api/work-rules");
  expect(rulesResponse.ok()).toBe(true);
  const { rules } = (await rulesResponse.json()) as {
    rules: Array<{ employeeId: string | null; name: string }>;
  };
  if (!rules.some((rule) => rule.name === "標準勤務" && !rule.employeeId)) {
    const created = await request.post("/api/work-rules", {
      data: {
        dailyStandardMinutes: 480,
        effectiveFrom: "2026-01-01",
        name: "標準勤務",
        scheduledBreakMinutes: 60,
        scheduledEndTime: "18:00",
        scheduledStartTime: "09:00",
      },
    });
    expect(created.status()).toBe(201);
  }
}

async function login(page: Page, email: string, password: string) {
  loginSequence += 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${loginSequence}` });
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function collectConsoleProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const source = message.location().url;
      problems.push(`${message.type()}: ${message.text()}${source ? ` (${source})` : ""}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.beforeAll(async ({ request }) => {
  await prepareAccounts(request);
});

test("public landing introduces the product and leads to login", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "勤怠と労務を、 すっきりひとつに。" }),
  ).toBeVisible();
  await expect(page.getByLabel("Kinmu-OSの管理画面プレビュー")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-root-after-desktop.png" });

  await page.setViewportSize({ height: 720, width: 320 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-root-after-mobile.png" });

  await page.getByRole("link", { name: "ログイン" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "おかえりなさい" })).toBeVisible();
  expect(consoleProblems).toEqual([]);
});

test("authentication shell is polished and responsive", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { level: 1, name: "おかえりなさい" })).toBeVisible();
  await expect(page.getByText("勤怠と労務を、")).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeFocused();
  await page.getByLabel("メールアドレス").fill("design-check@example.com");
  await page.getByLabel("パスワード").fill("DesignCheck-2026!");
  await expect(page.getByRole("button", { name: "ログイン" })).toBeEnabled();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-login-after-desktop.png" });

  await page.setViewportSize({ height: 720, width: 320 });
  await expect(page.locator(".auth-mobile-brand").getByText("KINMU-OS")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-login-after-mobile.png" });
  expect(consoleProblems).toEqual([]);
});

test("desktop user management shell and confirmation are accessible", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, owner.email, owner.password);
  await page.goto("/settings/users");

  await expect(page).toHaveTitle("Kinmu-OS");
  await expect(page.getByRole("heading", { level: 1, name: "利用者管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "利用者管理" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "一覧を更新" }).click();
  const employeeRow = page.getByRole("row").filter({ hasText: employee.email });
  await employeeRow.getByRole("button", { name: "無効化" }).click();
  const dialog = page.getByRole("alertdialog", { name: "利用者を無効化" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "キャンセル" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-os-desktop.png" });
  expect(consoleProblems).toEqual([]);
});

test("guided navigation preserves context and protects unfinished forms", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 1058, width: 1488 });
  await login(page, owner.email, owner.password);

  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
  await expect(page.locator(".workflow-progress")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v07-admin-home-desktop.png" });
  await page.goto("/attendance?month=2026-07");
  await expect(page.getByText("対象月の勤務実績を確認し").first()).toBeVisible();
  await expect(page.getByText("勤怠一覧を読み込んでいます")).toBeHidden();
  expect(
    await page.getByRole("table", { name: "勤怠一覧" }).getByRole("row").count(),
  ).toBeLessThanOrEqual(51);
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v07-attendance-desktop.png" });

  await page.goto("/attendance?month=2026-07&status=open");
  await expect(page.getByRole("link", { name: "この画面の使い方" })).toBeVisible();

  await page.getByRole("link", { name: "この画面の使い方" }).click();
  await expect(page).toHaveURL(/\/guide\/monthly-closing\?returnTo=/);
  await expect(page.getByRole("link", { name: /元の画面へ戻る/ })).toBeVisible();
  await page.getByRole("link", { name: /元の画面へ戻る/ }).click();
  await expect(page).toHaveURL(/\/attendance\?month=2026-07&status=open$/);

  await page.goto("/attendance/rules");
  await expect(page.getByRole("heading", { level: 1, name: "勤務ルール" })).toBeVisible();
  const nameField = page.getByLabel("ルール名");
  const startField = page.getByLabel("所定開始");
  await expect(nameField).toBeVisible();
  await nameField.fill(`未保存ルール-${runId}`);
  const [nameBox, startBox] = await Promise.all([
    nameField.boundingBox(),
    startField.boundingBox(),
  ]);
  expect(nameBox!.height).toBeGreaterThanOrEqual(44);
  expect(startBox!.height).toBeGreaterThanOrEqual(44);
  expect(nameBox!.width).toBeGreaterThan(startBox!.width);
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v07-work-rule-desktop.png" });

  await page.getByRole("button", { name: "日々の勤怠" }).click();
  await page.getByRole("link", { name: "勤怠状況" }).click();
  const unsavedDialog = page.getByRole("alertdialog", { name: "未保存の変更があります" });
  await expect(unsavedDialog).toBeVisible();
  await unsavedDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(nameField).toHaveValue(`未保存ルール-${runId}`);
  await page.getByRole("link", { name: "勤怠状況" }).click();
  await unsavedDialog.getByRole("button", { name: "変更を破棄して移動" }).click();
  await expect(page).toHaveURL(/\/attendance(?:\?month=\d{4}-\d{2})?$/);

  await page.setViewportSize({ height: 844, width: 320 });
  await page.getByRole("button", { name: "すべて" }).click();
  const drawer = page.getByRole("dialog", { name: "すべてのメニュー" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /閉じる/ })).toBeFocused();
  await page.screenshot({ fullPage: false, path: "/tmp/kinmu-v07-menu-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(consoleProblems).toEqual([]);
});

test("major management screens keep their purpose and fit narrow viewports", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await login(page, owner.email, owner.password);
  await page.setViewportSize({ height: 844, width: 320 });

  const routes = [
    "/",
    "/employees",
    "/employees/departments",
    "/employees/import",
    "/settings/users",
    "/settings/approval-delegations",
    "/settings/approval-routes",
    "/attendance",
    "/attendance/rules",
    "/attendance/corrections",
    "/approvals",
    "/approvals/proxy",
    "/calendar",
    "/leave/manage",
    "/leave/reviews",
    "/overtime/settings",
    "/overtime/reviews",
    "/reports",
    "/audit",
    "/payroll-exports",
    "/payroll-exports/profiles",
    "/payroll-exports/inspect",
    "/payroll-exports/runs",
    "/notifications",
    "/profile",
    "/guide",
    "/about",
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main h1").first(), route).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      route,
    ).toBe(true);
    await expect(page.locator("nextjs-portal"), route).toHaveCount(0);
  }

  await page.setViewportSize({ height: 900, width: 768 });
  for (const route of ["/attendance", "/employees", "/overtime/settings", "/guide"]) {
    await page.goto(route);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      route,
    ).toBe(true);
  }
  expect(consoleProblems).toEqual([]);
});

test("employee home and records work at 320 CSS pixels", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 720, width: 320 });
  await login(page, employee.email, employee.password);

  await expect(page.getByRole("heading", { level: 1, name: "今日の勤怠" })).toBeVisible();
  if (await page.getByRole("button", { name: "休憩を終了" }).isVisible()) {
    await page.getByRole("button", { name: "休憩を終了" }).click();
  }
  if (await page.getByRole("button", { name: "退勤する" }).isVisible()) {
    await page.getByRole("button", { name: "退勤する" }).click();
  }
  await expect(page.getByRole("button", { name: "出勤する" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: false, path: "/tmp/kinmu-os-mobile-home.png" });

  await page.getByRole("button", { name: "出勤する" }).click();
  await expect(page.getByRole("button", { name: "休憩を開始" })).toBeVisible();
  await page.getByRole("button", { name: "休憩を開始" }).click();
  await expect(page.getByRole("button", { name: "休憩を終了" })).toBeVisible();

  let rejectedOnce = false;
  await page.route("**/api/attendance/me", async (route) => {
    if (route.request().method() === "POST" && !rejectedOnce) {
      rejectedOnce = true;
      await route.fulfill({
        body: JSON.stringify({ error: "通信を確認して、もう一度お試しください。" }),
        contentType: "application/json",
        status: 422,
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "休憩を終了" }).click();
  await expect(page.getByText("通信を確認して、もう一度お試しください。")).toBeVisible();
  await page.unroute("**/api/attendance/me");
  await page.getByRole("button", { name: "休憩を終了" }).click();
  await page.getByRole("button", { name: "退勤する" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "退勤済み" })).toBeVisible();

  await page.getByRole("link", { name: "勤務実績" }).click();
  await expect(page).toHaveURL(/\/attendance\/me$/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { level: 1, name: "勤務実績" })).toBeVisible();
  await expect(page.getByLabel("表示する月")).toBeVisible();
  const workDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const attendanceDay = page
    .locator(".attendance-day-list article")
    .filter({ has: page.getByText(workDate, { exact: true }) });
  await attendanceDay.getByRole("button", { name: "修正を申請" }).click();
  const secondPunch = await page.getByLabel("2件目の時刻").inputValue();
  const [secondHour, secondMinute] = secondPunch.slice(11, 16).split(":").map(Number);
  const earlierMinute = Math.max(0, secondHour * 60 + secondMinute - 1);
  const earlierTime = `${String(Math.floor(earlierMinute / 60)).padStart(2, "0")}:${String(earlierMinute % 60).padStart(2, "0")}`;
  await page.getByLabel("1件目の時刻").fill(`${workDate}T${earlierTime}`);
  await page.getByLabel("修正理由").fill("出勤時刻を入力し直すため");
  await expect(page.getByText("変更", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-correction-mobile-edit.png" });
  await page.getByRole("button", { name: "この内容で申請" }).click();
  await expect(page.getByText("勤怠修正を申請しました。")).toBeVisible();
  await page.getByRole("button", { name: "申請を取り消す" }).click();
  await expect(page.getByText("申請を取り消しました。")).toBeVisible();

  await attendanceDay.getByRole("button", { name: "修正を申請" }).click();
  await page.getByLabel("1件目の時刻").fill(`${workDate}T${earlierTime}`);
  await page.getByLabel("修正理由").fill("管理者確認用の出勤時刻修正");
  await page.getByRole("button", { name: "この内容で申請" }).click();
  await expect(page.getByText("審査待ち", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: false, path: "/tmp/kinmu-os-mobile-records.png" });

  await page.goto("/requests");
  await expect(page.getByRole("heading", { level: 1, name: "申請履歴" })).toBeVisible();
  await expect(page.getByRole("link", { name: "詳細を確認" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "プロフィール" })).toBeVisible();
  await expect(page.getByRole("main").getByText("従業員 花子")).toBeVisible();
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "Kinmu-OSについて" })).toBeVisible();
  await expect(page.getByText("GNU Affero General Public License v3.0 only")).toBeVisible();
  await expect(page.getByRole("link", { name: /github\.com/ })).toBeVisible();
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  expect(consoleProblems.filter((problem) => !problem.includes("status of 422"))).toEqual([]);
});

test("HR reviews and approves an attendance correction", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);
  const employeesResponse = await page.request.get("/api/employees?status=all");
  const employeeRecords = (await employeesResponse.json()) as {
    employees: Array<{ employeeNumber: string; id: string }>;
  };
  const employeeRecord = employeeRecords.employees.find(
    (record) => record.employeeNumber === employee.employeeNumber,
  );
  expect(employeeRecord).toBeTruthy();
  await page.goto(`/attendance/corrections?status=pending&employeeId=${employeeRecord!.id}`);

  await expect(page).toHaveTitle("Kinmu-OS");
  await expect(page.getByRole("heading", { level: 1, name: "勤怠申請" })).toBeVisible();
  await expect(page.getByRole("link", { name: "勤怠申請" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: /従業員 花子/ }).click();
  await expect(page.getByText("管理者確認用の出勤時刻修正").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "修正前" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "申請後" })).toBeVisible();
  await expect(page.getByText("変更", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "却下する" })).toBeDisabled();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-correction-review-desktop.png" });

  await page.getByRole("button", { name: "承認する" }).click();
  const dialog = page.getByRole("alertdialog", { name: "勤怠修正を承認しますか？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "承認して反映" }).click();
  await expect(page.getByText("勤怠修正を承認し、集計へ反映しました。")).toBeVisible();
  await expect(
    page.locator(".status-pill").getByText("承認済み", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/employees");
  await page.getByRole("button", { name: "一覧を読み込む" }).click();
  await expect(page.getByText(employee.employeeNumber)).toBeVisible();
  const preview = await page.request.post("/api/imports/employees", {
    data: {
      csv: [
        "employeeNumber,familyName,givenName,displayName,contactEmail,departmentCode,joinedOn,employmentType,status",
        "UI-PREVIEW,検証,次郎,検証 次郎,preview@example.com,UI-TEST,2026-04-01,full_time,active",
      ].join("\n"),
      mode: "preview",
    },
  });
  expect(preview.ok()).toBe(true);
  expect(((await preview.json()) as { errors: unknown[] }).errors).toEqual([]);
  const employeeCsv = await page.request.get("/api/exports/employees");
  expect(employeeCsv.ok()).toBe(true);
  expect(await employeeCsv.text()).toContain(employee.employeeNumber);
  const attendanceCsv = await page.request.get(
    `/api/exports/attendance?month=${new Date().toISOString().slice(0, 7)}`,
  );
  expect(attendanceCsv.ok()).toBe(true);
  expect(await attendanceCsv.text()).toContain("修正済み");

  await login(page, employee.email, employee.password);
  await page.goto("/attendance/me");
  await expect(page.getByText("修正済み", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator(".status-pill").getByText("承認済み", { exact: true }).first(),
  ).toBeVisible();
  expect(consoleProblems).toEqual([]);
});

test("HR closes, reopens, and recloses a finished attendance month", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  const targetMonth = `2025-${String((Date.now() % 12) + 1).padStart(2, "0")}`;
  const workDate = `${targetMonth}-15`;
  const clockOutMinute = Date.now() % 50;
  const submitCorrection = async (minute: number, reason: string) => {
    const response = await page.request.post("/api/attendance/corrections", {
      data: {
        entries: [
          {
            occurredAt: `${workDate}T00:00:00.000Z`,
            originalEventId: null,
            type: "clock_in",
          },
          {
            occurredAt: `${workDate}T09:${String(minute).padStart(2, "0")}:30.000Z`,
            originalEventId: null,
            type: "clock_out",
          },
        ],
        reason,
        workDate,
      },
    });
    expect(response.status()).toBe(201);
  };
  const nextMonth = new Date(`${targetMonth}-01T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextMonthStart = nextMonth.toISOString().slice(0, 10);
  let managedEmployeeId = "";
  const approvePendingCorrection = async () => {
    await page.goto(
      `/attendance/corrections?status=pending&employeeId=${managedEmployeeId}&from=${targetMonth}-01&to=${nextMonthStart}`,
    );
    await page.getByRole("button", { name: /従業員 花子/ }).click();
    await page.getByRole("button", { name: "承認する" }).click();
    await page
      .getByRole("alertdialog", { name: "勤怠修正を承認しますか？" })
      .getByRole("button", { name: "承認して反映" })
      .click();
    await expect(page.getByText("勤怠修正を承認し、集計へ反映しました。")).toBeVisible();
  };
  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);
  const employeesResponse = await page.request.get("/api/employees?status=all");
  const employeeRecords = (await employeesResponse.json()) as {
    employees: Array<{ employeeNumber: string; id: string }>;
  };
  managedEmployeeId =
    employeeRecords.employees.find((record) => record.employeeNumber === employee.employeeNumber)
      ?.id ?? "";
  expect(managedEmployeeId).not.toBe("");

  const staleResponse = await page.request.get(
    `/api/attendance/correction-reviews?status=pending&employeeId=${managedEmployeeId}&from=${targetMonth}-01&to=${nextMonthStart}`,
  );
  expect(staleResponse.ok()).toBe(true);
  const staleRequests = (await staleResponse.json()) as { requests: Array<{ id: string }> };
  for (const staleRequest of staleRequests.requests) {
    const reviewResponse = await page.request.patch(
      `/api/attendance/correction-reviews/${staleRequest.id}`,
      { data: { decision: "approve" } },
    );
    expect(reviewResponse.ok()).toBe(true);
  }

  const stateResponse = await page.request.get(`/api/attendance/closing?month=${targetMonth}`);
  expect(stateResponse.ok()).toBe(true);
  const state = (await stateResponse.json()) as {
    closing: { period: { status: "closed" | "open"; version: number } };
  };
  if (state.closing.period.status === "closed") {
    const reset = await page.request.post("/api/attendance/closing", {
      data: {
        action: "reopen",
        expectedVersion: state.closing.period.version,
        month: targetMonth,
        reason: "E2E検証を開始するため再開します",
      },
    });
    expect(reset.ok()).toBe(true);
  }

  await login(page, employee.email, employee.password);
  await submitCorrection(clockOutMinute, "月次締め前の勤務時刻を登録するため");
  await login(page, hrAdmin.email, hrAdmin.password);

  await page.goto("/attendance");
  await page.getByLabel("対象月").fill(targetMonth);
  await page.getByRole("button", { exact: true, name: "表示" }).click();
  await expect(page.getByText(`${targetMonth} 月次勤怠`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "編集中" })).toBeVisible();
  await expect(
    page
      .locator(".attendance-closing__summary div")
      .filter({ hasText: "審査待ち" })
      .getByText("1件"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "この月を締める" })).toBeDisabled();
  await page.getByRole("link", { name: "審査待ち申請を確認" }).click();
  await approvePendingCorrection();
  await page.goto("/attendance");
  await page.getByLabel("対象月").fill(targetMonth);
  await page.getByRole("button", { exact: true, name: "表示" }).click();
  await page.getByRole("button", { name: "この月を締める" }).click();
  const closeDialog = page.getByRole("alertdialog", { name: `${targetMonth}を締めますか？` });
  await expect(closeDialog.getByText("締め後は勤怠を修正できません。")).toBeVisible();
  await closeDialog.getByRole("button", { name: "締めて確定" }).click();
  await expect(page.getByText("月次勤怠を締めました。")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "締め済み" })).toBeVisible();
  await expect(page.getByLabel("対象月")).toHaveValue(targetMonth);
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-monthly-closing-desktop.png" });

  await login(page, employee.email, employee.password);
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto(`/attendance/me?month=${targetMonth}`);
  await expect(page.getByText(/この月は締め済みです（リビジョン/)).toBeVisible();
  await expect(page.getByRole("button", { name: "締め済み" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-monthly-closing-mobile.png" });

  await login(page, hrAdmin.email, hrAdmin.password);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/attendance");
  await page.getByLabel("対象月").fill(targetMonth);
  await page.getByRole("button", { exact: true, name: "表示" }).click();
  await page.getByRole("button", { name: "締めを再開" }).click();
  const reopenDialog = page.getByRole("alertdialog", { name: "月次勤怠を再開しますか？" });
  await reopenDialog.getByLabel("再開理由（5文字以上）").fill("確定前の勤務内容を再確認するため");
  await expect(reopenDialog.getByLabel("再開理由（5文字以上）")).toBeFocused();
  await reopenDialog.getByRole("button", { name: "再開する" }).click();
  await expect(page.getByText("月次勤怠を再開しました。")).toBeVisible();

  await login(page, employee.email, employee.password);
  await submitCorrection(clockOutMinute + 5, "再開後に退勤時刻を修正するため");
  await login(page, hrAdmin.email, hrAdmin.password);
  await approvePendingCorrection();
  await page.goto("/attendance");
  await page.getByLabel("対象月").fill(targetMonth);
  await page.getByRole("button", { exact: true, name: "表示" }).click();
  await page.getByRole("button", { name: "この月を締める" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "締めて確定" }).click();
  await expect(page.getByText("月次勤怠を締めました。")).toBeVisible();
  await expect(page.getByText(/リビジョン \d+/)).toBeVisible();
  expect(consoleProblems).toEqual([]);
});

test("HR publishes a payroll profile, validates, generates, and preserves old runs", async ({
  page,
}) => {
  const consoleProblems = collectConsoleProblems(page);
  const targetMonth = `2024-${String((Date.now() % 12) + 1).padStart(2, "0")}`;
  const workDate = `${targetMonth}-14`;
  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);

  const initialClosingResponse = await page.request.get(
    `/api/attendance/closing?month=${targetMonth}`,
  );
  const initialClosing = (await initialClosingResponse.json()) as {
    closing: { period: { status: "closed" | "open"; version: number } };
  };
  if (initialClosing.closing.period.status === "closed") {
    const reopened = await page.request.post("/api/attendance/closing", {
      data: {
        action: "reopen",
        expectedVersion: initialClosing.closing.period.version,
        month: targetMonth,
        reason: "給与連携E2Eを再実行するため",
      },
    });
    expect(reopened.ok()).toBe(true);
  }

  const pendingResponse = await page.request.get(
    `/api/attendance/correction-reviews?status=pending&from=${targetMonth}-01&to=${targetMonth}-28`,
  );
  const pendingPayload = (await pendingResponse.json()) as {
    requests: Array<{ id: string; workDate: string }>;
  };
  let correctionId = pendingPayload.requests.find((request) => request.workDate === workDate)?.id;
  if (!correctionId) {
    await login(page, employee.email, employee.password);
    const correctionResponse = await page.request.post("/api/attendance/corrections", {
      data: {
        entries: [
          { occurredAt: `${workDate}T00:00:00.000Z`, originalEventId: null, type: "clock_in" },
          { occurredAt: `${workDate}T09:00:00.000Z`, originalEventId: null, type: "clock_out" },
        ],
        reason: "給与連携E2Eの締めスナップショットを作成するため",
        workDate,
      },
    });
    expect(correctionResponse.status()).toBe(201);
    const correction = (await correctionResponse.json()) as {
      correction: { request: { id: string } };
    };
    correctionId = correction.correction.request.id;
    await login(page, hrAdmin.email, hrAdmin.password);
  }
  const review = await page.request.patch(`/api/attendance/correction-reviews/${correctionId}`, {
    data: { decision: "approve" },
  });
  expect(review.ok()).toBe(true);
  const openStateResponse = await page.request.get(`/api/attendance/closing?month=${targetMonth}`);
  const openState = (await openStateResponse.json()) as {
    closing: { canClose: boolean; period: { version: number } };
  };
  expect(openState.closing.canClose).toBe(true);
  const closed = await page.request.post("/api/attendance/closing", {
    data: {
      action: "close",
      expectedVersion: openState.closing.period.version,
      month: targetMonth,
    },
  });
  expect(closed.ok()).toBe(true);

  const profilesResponse = await page.request.get("/api/payroll-exports/profiles");
  expect(profilesResponse.ok()).toBe(true);
  const profilesPayload = (await profilesResponse.json()) as {
    genericDraft: { draftConfig: unknown };
  };
  const createdProfileResponse = await page.request.post("/api/payroll-exports/profiles", {
    data: {
      config: profilesPayload.genericDraft.draftConfig,
      description: "Playwrightで公開・検査・再現性を確認するプロファイル",
      name: `E2E給与CSV-${runId}`,
    },
  });
  expect(createdProfileResponse.status()).toBe(201);
  const createdProfile = (await createdProfileResponse.json()) as {
    profile: { id: string };
  };

  await page.goto(`/payroll-exports/profiles/${createdProfile.profile.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `E2E給与CSV-${runId}` })).toBeVisible();
  await page.getByRole("button", { name: "ドラフトを保存・検査" }).click();
  await expect(page.getByText("設定を検査し、ドラフトを保存しました。")).toBeVisible();
  await page.getByRole("button", { name: "公開前の確認" }).click();
  const publishDialog = page.getByRole("alertdialog", {
    name: "新しい公開版を作成しますか？",
  });
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.getByRole("button", { name: "キャンセル" })).toBeFocused();
  await publishDialog.getByRole("button", { name: "この設定を公開" }).click();
  await expect(page.getByText("プロファイルを不変の公開版として保存しました。")).toBeVisible();
  await expect(page.getByText("公開版は変更できません")).toBeVisible();

  await page.goto(`/payroll-exports/profiles/${createdProfile.profile.id}/mappings`);
  await page.getByLabel("従業員を検索").fill(employee.employeeNumber);
  const mappingCard = page
    .locator(".payroll-mapping-card")
    .filter({ hasText: employee.employeeNumber });
  await mappingCard.getByLabel("外部従業員コード").fill(`PAY-${runId}`);
  await mappingCard.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/外部従業員コードを更新しました/)).toBeVisible();
  const allMappingsResponse = await page.request.get(
    `/api/payroll-exports/profiles/${createdProfile.profile.id}/mappings`,
  );
  const allMappings = (await allMappingsResponse.json()) as {
    mappings: Array<{
      employeeId: string;
      externalEmployeeCode: string | null;
      mappingVersion: number | null;
    }>;
  };
  for (const [index, mapping] of allMappings.mappings.entries()) {
    if (mapping.externalEmployeeCode) continue;
    const saved = await page.request.patch(
      `/api/payroll-exports/profiles/${createdProfile.profile.id}/mappings`,
      {
        data: {
          employeeId: mapping.employeeId,
          expectedVersion: mapping.mappingVersion ?? 0,
          externalEmployeeCode: `AUTO-${index}-${runId}`,
        },
      },
    );
    expect(saved.ok()).toBe(true);
  }

  await page.goto(
    `/payroll-exports/inspect?month=${targetMonth}&profileId=${createdProfile.profile.id}`,
  );
  await expect(page.getByRole("heading", { level: 1, name: "全件検査・CSV生成" })).toBeVisible();
  await page.getByRole("button", { name: "全件検査を実行" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "CSVを生成できます" })).toBeVisible();
  await expect(
    page.locator(".payroll-validation-summary dl div").filter({ hasText: "エラー" }),
  ).toContainText("0件");
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-payroll-inspection-desktop.png" });

  await page.getByRole("button", { name: "生成内容を確認" }).click();
  const generationDialog = page.getByRole("alertdialog", {
    name: "この条件で給与連携CSVを生成しますか？",
  });
  await expect(generationDialog.getByText("このCSVは給与計算結果ではありません。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(generationDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "生成内容を確認" })).toBeFocused();
  await page.getByRole("button", { name: "生成内容を確認" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("alertdialog", { name: "この条件で給与連携CSVを生成しますか？" })
    .getByRole("button", { name: "確認してCSVを生成" })
    .click();
  await downloadPromise;
  const generationMessage = page.getByText(/CSVを生成しました。run ID:/);
  await expect(generationMessage).toBeVisible();
  const generatedRunId = (await generationMessage.textContent())?.split("run ID: ").at(-1);
  expect(generatedRunId).toBeTruthy();

  await page.goto("/payroll-exports/runs");
  const firstRun = page.locator(".payroll-run-list article").filter({ hasText: generatedRunId! });
  await expect(firstRun.getByText("現在の締め版")).toBeVisible();
  const runIdText = await firstRun.locator("code").first().textContent();
  expect(runIdText).toBeTruthy();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-payroll-runs-desktop.png" });

  const currentStateResponse = await page.request.get(
    `/api/attendance/closing?month=${targetMonth}`,
  );
  const currentState = (await currentStateResponse.json()) as {
    closing: { period: { version: number } };
  };
  const reopened = await page.request.post("/api/attendance/closing", {
    data: {
      action: "reopen",
      expectedVersion: currentState.closing.period.version,
      month: targetMonth,
      reason: "旧給与連携runの表示を確認するため",
    },
  });
  expect(reopened.ok()).toBe(true);
  const reopenedPeriod = (await reopened.json()) as { period: { version: number } };
  const reclosed = await page.request.post("/api/attendance/closing", {
    data: {
      action: "close",
      expectedVersion: reopenedPeriod.period.version,
      month: targetMonth,
    },
  });
  expect(reclosed.ok()).toBe(true);
  await page.reload();
  const oldRun = page.locator(".payroll-run-list article").filter({ hasText: runIdText! });
  await expect(oldRun.getByText("旧リビジョン")).toBeVisible();
  const redownloadPromise = page.waitForEvent("download");
  await oldRun.getByRole("button", { name: "整合性確認して再ダウンロード" }).click();
  await redownloadPromise;
  await expect(page.getByText(/SHA-256一致を確認しました/)).toBeVisible();

  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/payroll-exports/profiles");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto(`/payroll-exports/profiles/${createdProfile.profile.id}/mappings`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto("/payroll-exports/runs");
  await expect(page.locator(".payroll-run-list article").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-payroll-runs-mobile.png" });
  expect(consoleProblems.filter((problem) => !problem.includes("eval() is not supported"))).toEqual(
    [],
  );
});

test("HR configures leave and an employee completes the mobile request workflow", async ({
  page,
}) => {
  const consoleProblems = collectConsoleProblems(page);
  const currentDate = new Date();
  const workday = new Date(currentDate);
  workday.setUTCDate(workday.getUTCDate() + 3);
  while (workday.getUTCDay() === 0 || workday.getUTCDay() === 6) {
    workday.setUTCDate(workday.getUTCDate() + 1);
  }
  const workDate = workday.toISOString().slice(0, 10);
  const grantedOn = currentDate.toISOString().slice(0, 10);

  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);
  const calendarResponse = await page.request.get("/api/calendar");
  const calendar = (await calendarResponse.json()) as {
    patterns: Array<{ id: string; status: "active" | "draft" | "inactive" }>;
  };
  const calendarWasActive = calendar.patterns.some((pattern) => pattern.status === "active");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "勤務カレンダー" })).toBeVisible();
  if (!calendarWasActive) {
    const activationButton = page.getByRole("button", { name: "影響を確認" }).first();
    await expect(activationButton).toBeVisible();
    await activationButton.click();
    const dialog = page.getByRole("alertdialog", { name: "勤務カレンダーを有効化しますか？" });
    await expect(dialog.getByText(/在籍従業員/)).toBeVisible();
    await dialog.getByRole("button", { name: "この内容で有効化" }).click();
    await expect(page.getByText(/勤務カレンダーを有効化しました/)).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "有効", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v04-calendar-desktop.png" });

  const typesResponse = await page.request.get("/api/leave/types");
  const typePayload = (await typesResponse.json()) as {
    leaveTypes: Array<{ code: string; id: string }>;
  };
  let leaveType = typePayload.leaveTypes.find((item) => item.code === "E2EPAID");
  if (!leaveType) {
    const createType = await page.request.post("/api/leave/types", {
      data: {
        action: "create",
        code: "E2EPAID",
        consumesBalance: true,
        effectiveFrom: "2026-01-01",
        name: "E2E年次有給休暇",
        paid: true,
        requestable: true,
      },
    });
    expect(createType.status()).toBe(201);
    leaveType = ((await createType.json()) as { leaveType: { code: string; id: string } })
      .leaveType;
  }

  const employeesResponse = await page.request.get("/api/employees?status=all");
  const employeeRecords = (await employeesResponse.json()) as {
    employees: Array<{ employeeNumber: string; id: string }>;
  };
  const employeeRecord = employeeRecords.employees.find(
    (record) => record.employeeNumber === employee.employeeNumber,
  );
  expect(employeeRecord).toBeTruthy();

  await page.goto("/leave/manage");
  await expect(page.getByRole("heading", { level: 1, name: "休暇管理" })).toBeVisible();
  const balanceForm = page.locator("form").filter({ has: page.locator("#balance-employee") });
  await balanceForm.locator("#balance-employee").selectOption(employeeRecord!.id);
  await balanceForm.locator("#balance-type").selectOption(leaveType!.id);
  await balanceForm.locator("#balance-date").fill(grantedOn);
  await balanceForm.locator("#balance-units").fill("4");
  await balanceForm.locator("#balance-reason").fill("E2E年度付与");
  await balanceForm.getByRole("button", { name: "台帳へ記録" }).click();
  await expect(page.getByText("休暇を付与しました。")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v04-leave-manage-desktop.png" });

  await login(page, employee.email, employee.password);
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/leave");
  await expect(page.getByRole("heading", { level: 1, name: "休暇" })).toBeVisible();
  await expect(page.getByText("E2E年次有給休暇").first()).toBeVisible();
  await page.getByLabel("休暇種別").selectOption(leaveType!.id);
  await page.getByLabel("申請単位").selectOption("full_day");
  await page.getByLabel("開始日").fill(workDate);
  await page.getByLabel("終了日").fill(workDate);
  await page.getByLabel("申請理由").fill("E2E休暇申請");
  await page.getByRole("button", { name: "対象日と残高を確認" }).click();
  const requestDialog = page.getByRole("alertdialog", { name: "休暇申請を送信しますか？" });
  await expect(requestDialog.getByText(workDate)).toBeVisible();
  await requestDialog.getByRole("button", { name: "この内容で申請" }).click();
  await expect(page.getByText(/休暇を申請しました/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v04-leave-mobile.png" });

  await login(page, hrAdmin.email, hrAdmin.password);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/leave/reviews?status=pending");
  await expect(page.getByRole("heading", { level: 1, name: "休暇審査" })).toBeVisible();
  const requestButton = page
    .locator(".review-list button")
    .filter({ hasText: employee.employeeNumber })
    .first();
  await requestButton.click();
  await expect(page.getByText("E2E休暇申請")).toBeVisible();
  await expect(page.getByRole("cell", { name: workDate })).toBeVisible();
  await page.getByRole("button", { name: "承認内容を確認" }).click();
  await page
    .getByRole("alertdialog", { name: "休暇申請を承認しますか？" })
    .getByRole("button", { name: "休暇を承認" })
    .click();
  await expect(page.getByText("休暇申請を承認しました。")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v04-leave-review-desktop.png" });

  const leaveCsv = await page.request.get(
    "/api/exports/leave-ledger?employeeId=" + employeeRecord!.id,
  );
  expect(leaveCsv.ok()).toBe(true);
  expect(await leaveCsv.text()).toContain("E2EPAID");
  expect(consoleProblems).toEqual([]);
});

test("role-specific guide navigation is accessible and responsive", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);
  await page.goto("/about");
  await page.getByRole("link", { name: "ガイドを開く" }).click();

  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole("heading", { level: 1, name: "利用ガイド" })).toBeVisible();
  await expect(page.getByText("ログイン中の役割: 労務管理者")).toBeVisible();
  const adminCards = page.locator(".guide-card");
  await expect(adminCards.first()).toContainText("初期設定と従業員管理");
  await adminCards.first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guide\/admin-setup$/);
  await expect(page.getByRole("heading", { level: 1, name: "初期設定と従業員管理" })).toBeVisible();
  await expect(page.locator(".guide-breadcrumb")).toContainText("利用ガイド");
  await expect(page.getByText("対象役割所有者・労務管理者")).toBeVisible();
  await page.getByRole("link", { name: "ガイド一覧へ戻る" }).click();
  await expect(page).toHaveURL(/\/guide$/);
  const articleHrefs = await page
    .locator(".guide-card")
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href")));
  expect(articleHrefs).toHaveLength(13);
  for (const href of articleHrefs) {
    expect(href).toBeTruthy();
    const response = await page.goto(href!);
    expect(response?.ok()).toBe(true);
    await expect(page.locator(".guide-prose h1")).toHaveCount(1);
    await expect(page.locator(".guide-load-error")).toHaveCount(0);
  }
  await page.goto("/guide");
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-guide-desktop.png" });

  const notFoundResponse = await page.goto("/guide/not-a-guide");
  expect(notFoundResponse?.status()).toBe(404);
  await expect(page.locator(".guide-prose")).toHaveCount(0);

  await login(page, employee.email, employee.password);
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/guide");
  await expect(page.getByText("ログイン中の役割: 従業員")).toBeVisible();
  const forbiddenGuide = await page.goto("/guide/admin-setup");
  expect(forbiddenGuide?.status()).toBe(404);
  await page.goto("/guide");
  await expect(page.locator(".guide-card").first()).toContainText("残業・休日出勤申請");
  await page.locator(".guide-card").first().click();
  await expect(page).toHaveURL(/\/guide\/overtime-requests$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole("heading", { level: 1, name: "残業・休日出勤申請" })).toBeVisible();
  await expect(page.locator(".guide-breadcrumb")).toContainText("残業・休日出勤申請");
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-guide-mobile.png" });
  expect(consoleProblems.filter((problem) => !problem.includes("status of 404"))).toEqual([]);
});

test("employee overtime request, HR review, notification, and difference work at 320 pixels", async ({
  page,
}) => {
  const consoleProblems = collectConsoleProblems(page);
  const candidate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

  await page.setViewportSize({ height: 900, width: 1440 });
  await login(page, hrAdmin.email, hrAdmin.password);
  const policiesResponse = await page.request.get("/api/overtime/policies");
  const existingPolicyDates = new Set(
    (
      (await policiesResponse.json()) as { policies: Array<{ effectiveFrom: string }> }
    ).policies.map((policy) => policy.effectiveFrom),
  );
  while (
    candidate.getUTCDay() === 0 ||
    candidate.getUTCDay() === 6 ||
    existingPolicyDates.has(candidate.toISOString().slice(0, 10))
  ) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  const workDate = candidate.toISOString().slice(0, 10);
  await page.goto("/overtime/settings");
  await expect(page.getByRole("heading", { level: 1, name: "残業申請設定" })).toBeVisible();
  await page.getByLabel("適用開始日").fill(workDate);
  await page.getByLabel("時刻の入力単位").selectOption("15");
  await page.getByLabel("実績差異の許容").fill("15");
  await page.getByRole("button", { exact: true, name: "ドラフトを保存" }).click();
  await expect(page.getByText("残業申請設定をドラフト保存しました。")).toBeVisible();
  await page.getByRole("button", { name: "影響を確認して有効化" }).click();
  const policyDialog = page.getByRole("alertdialog", { name: "設定の影響を確認" });
  await expect(policyDialog.getByText(/対象従業員/)).toBeVisible();
  await policyDialog.getByRole("button", { name: "この設定を有効化" }).click();
  await expect(page.getByText("残業申請設定を有効化しました。")).toBeVisible();

  await login(page, employee.email, employee.password);
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/overtime");
  await expect(page.getByRole("heading", { level: 1, name: "残業・休日出勤" })).toBeVisible();
  await page.getByLabel("勤務日").fill(workDate);
  await page.getByLabel("予定開始").fill("18:00");
  await page.getByLabel("予定終了").fill("19:00");
  await page.getByLabel("予定休憩").fill("0");
  await page.getByLabel("申請理由").fill("E2E残業申請の確認");
  const headingLevels = await page
    .locator("main h1, main h2, main h3")
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
  expect(headingLevels[0]).toBe(1);
  expect(
    headingLevels.every((level, index) => index === 0 || level <= headingLevels[index - 1] + 1),
  ).toBe(true);
  const previewButton = page.getByRole("button", { name: "勤務予定と申請分数を確認" });
  await previewButton.focus();
  await page.keyboard.press("Enter");
  const requestDialog = page.getByRole("alertdialog", { name: "申請内容を確認" });
  await expect(requestDialog.getByText("60分")).toBeVisible();
  const cancelRequestButton = requestDialog.getByRole("button", { name: "キャンセル" });
  const submitRequestButton = requestDialog.getByRole("button", { name: "この内容で申請" });
  await expect(cancelRequestButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(submitRequestButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelRequestButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(requestDialog).toBeHidden();
  await expect(previewButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(requestDialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(submitRequestButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("残業・休日出勤申請を送信しました。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v05-overtime-mobile.png" });

  await login(page, hrAdmin.email, hrAdmin.password);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");
  const pendingOvertimeSummary = page
    .locator(".dashboard-summary > div")
    .filter({ hasText: "審査待ち残業" });
  const pendingOvertimeLink = pendingOvertimeSummary.getByRole("link");
  await expect(pendingOvertimeLink).toHaveAttribute(
    "href",
    "/approvals?status=pending&requestType=overtime",
  );
  await pendingOvertimeLink.click();
  await expect(page).toHaveURL(/\/approvals\?status=pending&requestType=overtime/);
  const reviewItem = page
    .getByRole("row")
    .filter({ hasText: workDate })
    .filter({ hasText: "残業" })
    .getByRole("link", { name: "内容を確認して審査" });
  await expect(reviewItem).toHaveCount(1);
  await reviewItem.click();
  await expect(page.getByRole("heading", { level: 1, name: "残業の確認" })).toBeVisible();
  const reviewButton = page.getByRole("button", { name: "承認する" });
  await reviewButton.focus();
  await page.keyboard.press("Enter");
  const reviewDialog = page.getByRole("alertdialog", { name: "この審査結果でよいですか？" });
  await expect(reviewDialog.getByRole("button", { name: "キャンセル" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reviewDialog.getByRole("button", { name: "承認を確定" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("申請を承認しました。")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/kinmu-v05-overtime-review-desktop.png" });

  await login(page, employee.email, employee.password);
  const correctionResponse = await page.request.post("/api/attendance/corrections", {
    data: {
      entries: [
        { occurredAt: `${workDate}T00:00:00.000Z`, type: "clock_in" },
        { occurredAt: `${workDate}T03:00:00.000Z`, type: "break_start" },
        { occurredAt: `${workDate}T04:00:00.000Z`, type: "break_end" },
        { occurredAt: `${workDate}T10:00:00.000Z`, type: "clock_out" },
      ],
      reason: "E2E残業申請と実績差異を確認するため",
      workDate,
    },
  });
  expect(correctionResponse.ok()).toBe(true);
  const correction = (await correctionResponse.json()) as {
    correction: { request: { id: string } };
  };
  await login(page, hrAdmin.email, hrAdmin.password);
  const correctionReview = await page.request.patch(
    `/api/attendance/correction-reviews/${correction.correction.request.id}`,
    { data: { decision: "approve" } },
  );
  expect(correctionReview.ok()).toBe(true);
  await page.goto(`/attendance?month=${workDate.slice(0, 7)}&overtimeStatus=within_request`);
  const reconciledRow = page
    .getByRole("row")
    .filter({ hasText: "従業員 花子" })
    .filter({ hasText: workDate });
  await expect(reconciledRow).toContainText("申請内");

  const auditResponse = await page.request.get(
    `/api/audit?action=overtime_request_approved&overtimeRequestKind=overtime&targetMonth=${workDate.slice(0, 7)}`,
  );
  expect(auditResponse.ok()).toBe(true);
  const audit = (await auditResponse.json()) as {
    logs: Array<{ action: string; metadata: { workDate?: string } }>;
  };
  expect(audit.logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "overtime_request_approved",
        metadata: expect.objectContaining({ workDate }),
      }),
    ]),
  );

  const attendanceCsv = await page.request.get(
    `/api/exports/attendance?month=${workDate.slice(0, 7)}&requestStatus=approved&overtimeStatus=within_request`,
  );
  expect(attendanceCsv.ok()).toBe(true);
  const csvText = await attendanceCsv.text();
  expect(csvText.charCodeAt(0)).toBe(0xfeff);
  expect(csvText).toContain("残業・休日出勤申請ID");
  expect(csvText).toContain("実績差異状態");
  expect(csvText).toContain("法令適合を自動判定しません");

  await login(page, employee.email, employee.password);
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/notifications");
  await expect(page.getByText("残業申請が承認されました").first()).toBeVisible();
  const notificationButton = page.getByRole("button", { name: /残業申請が承認されました/ }).first();
  await notificationButton.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(consoleProblems).toEqual([]);
});

test("proxy attendance correction is returned, revised, approved, and closed through the unified flow", async ({
  page,
}) => {
  const consoleProblems = collectConsoleProblems(page);
  const scenarioStamp = Date.now();
  const workDate = `2026-${String((scenarioStamp % 5) + 1).padStart(2, "0")}-${String(
    (Math.floor(scenarioStamp / 5) % 20) + 1,
  ).padStart(2, "0")}`;

  await login(page, hrAdmin.email, hrAdmin.password);
  const [usersResponse, departmentsResponse, employeesResponse] = await Promise.all([
    page.request.get("/api/users"),
    page.request.get("/api/departments"),
    page.request.get("/api/employees"),
  ]);
  expect(usersResponse.ok()).toBe(true);
  expect(departmentsResponse.ok()).toBe(true);
  expect(employeesResponse.ok()).toBe(true);
  const { users } = (await usersResponse.json()) as {
    users: Array<{ email: string; id: string }>;
  };
  const { departments } = (await departmentsResponse.json()) as {
    departments: Array<{ code: string; id: string }>;
  };
  const { employees } = (await employeesResponse.json()) as {
    employees: Array<{ employeeNumber: string; id: string }>;
  };
  const approverUser = users.find((user) => user.email === approver.email);
  const department = departments.find((item) => item.code === "UI-TEST");
  const targetEmployee = employees.find((item) => item.employeeNumber === employee.employeeNumber);
  expect(approverUser).toBeTruthy();
  expect(department).toBeTruthy();
  expect(targetEmployee).toBeTruthy();

  const routesResponse = await page.request.get("/api/approvals/routes");
  expect(routesResponse.ok()).toBe(true);
  const { routes } = (await routesResponse.json()) as {
    routes: Array<{
      approverUserId: string;
      departmentId: string;
      effectiveTo: string | null;
      requestType: string;
    }>;
  };
  if (
    !routes.some(
      (route) =>
        route.approverUserId === approverUser!.id &&
        route.departmentId === department!.id &&
        route.requestType === "attendance_correction" &&
        !route.effectiveTo,
    )
  ) {
    const routeResponse = await page.request.post("/api/approvals/routes", {
      data: {
        approverUserId: approverUser!.id,
        departmentId: department!.id,
        dueDays: 2,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        requestType: "attendance_correction",
      },
    });
    expect(routeResponse.status()).toBe(201);
  }

  const proxyResponse = await page.request.post("/api/attendance/corrections", {
    data: {
      employeeId: targetEmployee!.id,
      entries: [
        { occurredAt: `${workDate}T00:00:00.000Z`, type: "clock_in" },
        { occurredAt: `${workDate}T09:00:00.000Z`, type: "clock_out" },
      ],
      proxyReason: "本人から電話で依頼を受けたため",
      reason: "代理作成から差し戻し・再申請までを確認",
      workDate,
    },
  });
  expect(proxyResponse.status()).toBe(201);

  await login(page, approver.email, approver.password);
  await page.goto("/approvals?status=pending&requestType=attendance_correction");
  const pendingRow = page
    .getByRole("row")
    .filter({ hasText: workDate })
    .filter({ hasText: "勤怠修正" });
  await expect(pendingRow).toHaveCount(1);
  await pendingRow.getByRole("link", { name: "内容を確認して審査" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "勤怠修正の確認" })).toBeVisible();
  await expect(page.getByText("管理者による代理作成")).toBeVisible();
  await page.getByLabel("審査コメント").fill("退勤時刻の根拠を確認して再申請してください。");
  await page.getByRole("button", { name: "修正を依頼して差し戻す" }).click();
  const returnDialog = page.getByRole("alertdialog", {
    name: "この審査結果でよいですか？",
  });
  await returnDialog.getByRole("button", { name: "差し戻しを確定" }).click();
  await expect(page.getByText("理由を添えて差し戻しました。")).toBeVisible();
  await expect(page.getByText("差し戻し中", { exact: true })).toBeVisible();

  await login(page, employee.email, employee.password);
  await page.goto("/requests");
  const returnedRow = page
    .getByRole("row")
    .filter({ hasText: workDate })
    .filter({ hasText: "差し戻し・修正待ち" });
  await expect(returnedRow).toHaveCount(1);
  await returnedRow.getByRole("link", { name: "理由を確認して修正" }).click();
  await expect(page.getByText("退勤時刻の根拠を確認して再申請してください。")).toBeVisible();
  await page.getByLabel("申請理由").fill("本人確認済み。退勤記録を再確認しました。");
  await page.getByRole("button", { name: "修正内容を再申請" }).click();
  await expect(page.getByText("修正内容を再申請しました。")).toBeVisible();
  await expect(page.getByText("第2版", { exact: true })).toBeVisible();

  await login(page, approver.email, approver.password);
  await page.goto("/approvals?status=pending&requestType=attendance_correction");
  const resubmittedRow = page
    .getByRole("row")
    .filter({ hasText: workDate })
    .filter({ hasText: "勤怠修正" });
  await expect(resubmittedRow).toHaveCount(1);
  await resubmittedRow.getByRole("link", { name: "内容を確認して審査" }).click();
  await page.getByRole("button", { name: "承認する" }).click();
  const approveDialog = page.getByRole("alertdialog", {
    name: "この審査結果でよいですか？",
  });
  await approveDialog.getByRole("button", { name: "承認を確定" }).click();
  await expect(page.getByText("申請を承認しました。")).toBeVisible();
  await expect(page.getByText("承認済み", { exact: true })).toBeVisible();

  await login(page, employee.email, employee.password);
  await page.goto("/notifications");
  await expect(page.getByText("勤怠修正申請が承認されました").first()).toBeVisible();

  await login(page, hrAdmin.email, hrAdmin.password);
  const closingResponse = await page.request.get(
    `/api/attendance/closing?month=${workDate.slice(0, 7)}`,
  );
  expect(closingResponse.ok()).toBe(true);
  const closing = (await closingResponse.json()) as {
    closing: { canClose: boolean; period: { version: number } };
  };
  expect(closing.closing.canClose).toBe(true);
  const closeResponse = await page.request.post("/api/attendance/closing", {
    data: {
      action: "close",
      expectedVersion: closing.closing.period.version,
      month: workDate.slice(0, 7),
    },
  });
  const closePayload = (await closeResponse.json()) as { error?: string };
  expect(closeResponse.ok(), closePayload.error).toBe(true);
  expect(consoleProblems).toEqual([]);
});
