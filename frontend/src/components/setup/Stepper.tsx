/**
 * Stepper — left-rail progress indicator for the setup wizard.
 *
 * Visual identity: each step marker is an angular diamond (rotated square),
 * reinforcing the crystal-fragment motif. Completed steps have a solid
 * accent diamond; the active step has an accent-bordered open diamond;
 * upcoming steps have a dim border only.
 */
import './Stepper.css';

export interface StepDef {
  id: number;
  label: string;
  sublabel: string;
}

interface StepperProps {
  steps: StepDef[];
  current: number;
}

export default function Stepper({ steps, current }: StepperProps) {
  return (
    <nav className="wizard-stepper" aria-label="Setup progress">
      <ol className="wizard-stepper-list">
        {steps.map((step, idx) => {
          const state: 'done' | 'active' | 'upcoming' =
            idx < current ? 'done' : idx === current ? 'active' : 'upcoming';

          return (
            <li
              key={step.id}
              className={`wizard-step wizard-step--${state}`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="wizard-step-marker" aria-hidden="true">
                {state === 'done' ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2.5 7l3 3 6-6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="wizard-step-num">{step.id}</span>
                )}
              </span>
              {idx < steps.length - 1 && (
                <span
                  className={`wizard-step-connector wizard-step-connector--${state === 'done' ? 'done' : 'upcoming'}`}
                  aria-hidden="true"
                />
              )}
              <div className="wizard-step-text">
                <span className="wizard-step-label">{step.label}</span>
                <span className="wizard-step-sublabel">{step.sublabel}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
