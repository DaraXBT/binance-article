'use client';

import { Check } from 'lucide-react';

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
}

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function WizardStepper({
  steps,
  currentStep,
  onStepClick,
}: WizardStepperProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex flex-col items-center flex-1">
            {/* Step circle */}
            <button
              onClick={() => onStepClick?.(index)}
              disabled={index > currentStep}
              className="relative mb-2 h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                borderColor:
                  index < currentStep
                    ? 'hsl(var(--primary))'
                    : index === currentStep
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--border))',
                backgroundColor:
                  index < currentStep
                    ? 'hsl(var(--primary))'
                    : index === currentStep
                      ? 'hsl(var(--primary))/10'
                      : 'transparent',
              }}
            >
              {index < currentStep ? (
                <Check className="h-5 w-5 text-primary" />
              ) : (
                <span
                  className={
                    index === currentStep
                      ? 'font-semibold text-primary'
                      : 'text-muted-foreground'
                  }
                >
                  {index + 1}
                </span>
              )}
            </button>

            {/* Step label */}
            <div className="text-center">
              <p className="text-sm font-medium">{step.title}</p>
              {step.description && (
                <p className="text-xs text-muted-foreground">{step.description}</p>
              )}
            </div>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className="absolute h-0.5 w-[calc(100%_-_2rem)] top-5"
                style={{
                  left: 'calc(50% + 1rem)',
                  backgroundColor:
                    index < currentStep
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--border))',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
