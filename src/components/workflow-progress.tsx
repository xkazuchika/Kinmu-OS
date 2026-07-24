import Link from "next/link";

import type { WorkflowProgress, WorkflowStepStatus } from "@/lib/workflow-progress";

const statusLabel: Readonly<Record<WorkflowStepStatus, string>> = {
  blocked: "要対応",
  completed: "完了",
  in_progress: "次に対応",
  not_applicable: "対象外",
  not_started: "未着手",
};

export function WorkflowProgressPanel({
  progress,
  title,
}: {
  progress: WorkflowProgress;
  title: string;
}) {
  const allComplete = progress.completedCount === progress.totalCount;
  return (
    <section className="workflow-progress">
      <header>
        <div>
          <p>{allComplete ? "準備完了" : "現在の進み具合"}</p>
          <h2>{title}</h2>
        </div>
        <strong>
          {progress.completedCount}/{progress.totalCount} 完了
        </strong>
      </header>
      <ol>
        {progress.steps.map((step) => (
          <li
            className={`workflow-progress__step workflow-progress__step--${step.status}`}
            key={step.id}
          >
            <span aria-hidden="true" className="workflow-progress__marker" />
            <div>
              <span className="workflow-progress__status">{statusLabel[step.status]}</span>
              <h3>{step.label}</h3>
              {step.reason ? <p>{step.reason}</p> : null}
            </div>
            {step.status !== "completed" && step.status !== "not_applicable" ? (
              <Link href={step.href}>
                {step.status === "blocked" ? "対応する" : "この作業を開く"}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
      {progress.current ? (
        <div className="workflow-progress__next">
          <span>次にやること</span>
          <strong>{progress.current.label}</strong>
          <Link className="ui-button ui-button--primary" href={progress.current.href}>
            {progress.current.status === "blocked" ? "未完了を確認" : "作業を始める"}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
