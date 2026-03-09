'use client';

import { Check, Sparkles } from 'lucide-react';

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

const STEP_CIRCLE_SIZE = 48;
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
                className="pointer-events-none absolute top-[24px] h-[3px] -translate-y-1/2"
                style={{
                  left: `calc(${((index + 0.5) / steps.length) * 100}% + ${STEP_CIRCLE_RADIUS}px)`,
                  width: `calc(${100 / steps.length}% - ${STEP_CIRCLE_SIZE}px)`,
                }}
              >
                {/* Track */}
                <div className="absolute inset-0 rounded-full bg-border/60" />
                {/* Fill */}
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out',
                    isComplete
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      : isActive
                        ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-orange-400 [background-size:200%_100%] animate-[stepper-gradient_3s_ease_infinite]'
                        : 'bg-transparent'
                  )}
                  style={{ width: connectorWidth }}
                />
                {/* Pulse dot on active connector */}
                {isActive ? (
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-[0_0_12px_3px_rgba(250,204,21,0.5)] animate-[stepper-dot_1.8s_ease-in-out_infinite]"
                    style={{ left: connectorWidth }}
                  />
                ) : null}
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
                    'group relative mb-3 flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold transition-all duration-500 disabled:cursor-not-allowed',
                    // Completed
                    isComplete &&
                      'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-105',
                    // Current
                    isCurrent &&
                      'bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 animate-[stepper-glow_3s_ease-in-out_infinite]',
                    // Future
                    isFuture &&
                      'border-2 border-border/80 bg-muted/40 text-muted-foreground/60 backdrop-blur-sm'
                  )}
                >
                  {/* Animated ring for current step */}
                  {isCurrent && (
                    <>
                      <span className="absolute inset-[-4px] rounded-full border-2 border-amber-400/40 animate-[stepper-ring_2.5s_ease-in-out_infinite]" />
                      <span className="absolute inset-[-8px] rounded-full border border-amber-300/15 animate-[stepper-ring_2.5s_ease-in-out_infinite_0.3s]" />
                    </>
                  )}

                  {/* Inner content */}
                  {isComplete ? (
                    <Check className="h-5 w-5 drop-shadow-sm" strokeWidth={3} />
                  ) : (
                    <span className={cn(
                      'relative z-10 tabular-nums',
                      isCurrent && 'drop-shadow-sm'
                    )}>
                      {index + 1}
                    </span>
                  )}

                  {/* Subtle shine overlay */}
                  <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/20 to-transparent" />
                </button>

                {/* Label */}
                <div className="max-w-[11rem] text-center">
                  <p
                    className={cn(
                      'text-sm font-semibold tracking-tight transition-colors duration-300',
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
                        'mt-1 text-[11px] leading-4 transition-colors duration-300 sm:text-xs',
                        isComplete && 'text-emerald-500/70 dark:text-emerald-400/60',
                        isCurrent && 'text-amber-600/80 dark:text-amber-300/80',
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
