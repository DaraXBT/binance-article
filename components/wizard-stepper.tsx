'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

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

const STEP_CIRCLE_SIZE = 40;
const STEP_CIRCLE_RADIUS = STEP_CIRCLE_SIZE / 2;

export function WizardStepper({
  steps,
  currentStep,
  onStepClick,
}: WizardStepperProps) {
  return (
    <div className="w-full">
      <div className="relative">
        <div
          className="grid items-start gap-3"
          style={{
            gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
          }}
        >
          {/* ── Connectors ── */}
          {steps.slice(0, -1).map((step, index) => {
            const isComplete = index < currentStep;
            const isActive = index === currentStep && currentStep < steps.length - 1;
            const connectorWidth = isComplete ? '100%' : isActive ? '50%' : '0%';

            return (
              <div
                key={`${step.id}-connector`}
                className="pointer-events-none absolute top-[20px] h-px -translate-y-1/2"
                style={{
                  left: `calc(${((index + 0.5) / steps.length) * 100}% + ${STEP_CIRCLE_RADIUS}px)`,
                  width: `calc(${100 / steps.length}% - ${STEP_CIRCLE_SIZE}px)`,
                }}
              >
                {/* Track */}
                <div className="absolute inset-0 border-t border-dotted border-border/80" />
                {/* Fill */}
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 border-t transition-[width] duration-200',
                    isComplete
                      ? 'border-emerald-600 dark:border-emerald-300'
                      : isActive
                        ? 'border-primary'
                        : 'border-transparent'
                  )}
                  style={{ width: connectorWidth }}
                />
              </div>
            );
          })}

          {/* ── Steps ── */}
          {steps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;
            const isFuture = index > currentStep;

            return (
              <div key={step.id} className="relative z-10 flex min-w-0 flex-col items-center">
                <button
                  type="button"
                  onClick={() => onStepClick?.(index)}
                  disabled={index > currentStep}
                  className={cn(
                    'group relative mb-3 flex size-10 items-center justify-center border text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed',
                    // Completed
                    isComplete &&
                      'border-emerald-600 bg-emerald-600 text-white hover:brightness-110 dark:border-emerald-300 dark:bg-emerald-300 dark:text-background',
                    // Current
                    isCurrent &&
                      'border-primary bg-primary text-primary-foreground',
                    // Future
                    isFuture &&
                      'border-dotted border-border/80 bg-muted/40 text-muted-foreground/60'
                  )}
                >
                  {isComplete ? (
                    <Check className="size-4" strokeWidth={2.5} />
                  ) : (
                    <span className={cn(
                      'relative z-10 tabular-nums'
                    )}>
                      {index + 1}
                    </span>
                  )}
                </button>

                {/* Label */}
                <div className="max-w-[11rem] text-center">
                  <p
                    className={cn(
                      'text-xs font-semibold tracking-normal transition-colors duration-150 sm:text-sm',
                      isComplete && 'text-emerald-600 dark:text-emerald-400',
                      isCurrent && 'text-foreground',
                      isFuture && 'text-muted-foreground/60'
                    )}
                  >
                    {step.title}
                  </p>
                  {step.description ? (
                    <p
                      className={cn(
                        'mt-1 hidden text-[11px] leading-4 transition-colors duration-150 sm:block sm:text-xs',
                        isComplete && 'text-emerald-500/70 dark:text-emerald-400/60',
                        isCurrent && 'text-primary/80',
                        isFuture && 'text-muted-foreground/40'
                      )}
                    >
                      {step.description}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
