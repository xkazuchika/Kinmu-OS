import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const owner = {
  email: "owner.ui-test@example.com",
  password: "OwnerUiTest-2026!",
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
    role: "hr_admin" | "employee",
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
      problems.push(`${message.type()}: ${message.text()}`);
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

test("employee home and records work at 320 CSS pixels", async ({ page }) => {
  const consoleProblems = collectConsoleProblems(page);
  await page.setViewportSize({ height: 720, width: 320 });
  await login(page, employee.email, employee.password);

  await expect(page.getByRole("heading", { level: 1, name: "おはようございます" })).toBeVisible();
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
  const attendanceDay = page.locator(".attendance-day-list article").first();
  const workDate = (await attendanceDay.locator("strong").first().textContent())!.trim();
  await attendanceDay.getByRole("button", { name: "修正を申請" }).click();
  await page.getByLabel("1件目の時刻").fill(`${workDate}T09:00`);
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
  await page.getByLabel("1件目の時刻").fill(`${workDate}T09:00`);
  await page.getByLabel("修正理由").fill("管理者確認用の出勤時刻修正");
  await page.getByRole("button", { name: "この内容で申請" }).click();
  await expect(page.getByText("審査待ち", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ fullPage: false, path: "/tmp/kinmu-os-mobile-records.png" });

  await page.getByRole("link", { name: "プロフィール" }).click();
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
  await page.goto("/attendance/corrections?status=pending");

  await expect(page).toHaveTitle("Kinmu-OS");
  await expect(page.getByRole("heading", { level: 1, name: "勤怠申請" })).toBeVisible();
  await expect(page.getByRole("link", { name: "勤怠申請" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page
    .getByRole("button", { name: /従業員 花子/ })
    .first()
    .click();
  await expect(page.getByText("管理者確認用の出勤時刻修正")).toBeVisible();
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
