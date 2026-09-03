export interface GuideStep {
  label: string;
  /** Whichever of these steps is first not "done" is the one marked "current" (a gentle pulse) -
   * every step's status is derived straight from existing workspace state (a file is loaded, the
   * Files Log is loaded, a comparison has run), so there's nothing extra to keep in sync. */
  done: boolean;
}

interface StepGuideProps {
  steps: GuideStep[];
}

/** A cheap, CSS-only "what's next" tracker - three small connected dots/labels, not a JS-driven
 * wizard or tour library. No extra state, no animation frames run in JS; the only per-frame work
 * is the current step's dot pulsing via a plain CSS keyframe, which the GPU compositor handles
 * without re-rendering React at all. */
export function StepGuide({ steps }: StepGuideProps) {
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <ol className="step-guide" aria-label="Workflow progress">
      {steps.map((step, i) => {
        const status = step.done ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={step.label} className={`step-guide-item step-guide-${status}`}>
            <span className="step-guide-dot" aria-hidden="true">
              {status === "done" ? "✓" : i + 1}
            </span>
            <span className="step-guide-label">{step.label}</span>
            {i < steps.length - 1 && <span className="step-guide-connector" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
