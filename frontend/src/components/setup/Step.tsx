/**
 * Step — wrapper for a single wizard panel.
 * Provides consistent heading + description + content + action slots.
 */
import { ReactNode } from 'react';
import './Step.css';

interface StepProps {
  title: string;
  description: string;
  children: ReactNode;
  /** Bottom action bar content */
  actions: ReactNode;
}

export default function Step({
  title,
  description,
  children,
  actions,
}: StepProps) {
  return (
    <section className="wizard-step-panel">
      <header className="wizard-step-header">
        <h2 className="wizard-step-title">{title}</h2>
        <p className="wizard-step-description">{description}</p>
      </header>
      <div className="wizard-step-body">{children}</div>
      <footer className="wizard-step-actions">{actions}</footer>
    </section>
  );
}
