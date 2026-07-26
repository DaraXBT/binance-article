'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ConsoleHeader,
  ConsolePanel,
  FrameCornerHandles,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { WizardStepper, WizardStep } from '@/components/wizard-stepper';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentStep } from './steps/content-step';
import { StyleStep } from './steps/style-step';
import { GenerateStep } from './steps/generate-step';
import { UrlStep } from './steps/url-step';
import { PromptStep } from './steps/prompt-step';
import { DEFAULT_ILLUSTRATION_STYLE } from '@/lib/config';
import { useGenerationLock } from '@/lib/hooks';
import type { WizardFormData, WizardFormUpdate, WizardMode } from './steps/types';

function parseWizardMode(value: string | null): WizardMode {
  return value === 'url' || value === 'prompt' ? value : 'text';
}

const WIZARD_MODES: ReadonlyArray<{ id: WizardMode; label: string }> = [
  { id: 'text', label: 'Paste text' },
  { id: 'url', label: 'Import URL' },
  { id: 'prompt', label: 'Topic prompt' },
];

function NewDeckWizard() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<WizardMode>(() => parseWizardMode(searchParams.get('mode')));
  const { messages } = useLanguage();
  const {
    generationLocked,
    unlockGeneration,
    markGenerationAccessLost,
    workspaceQuery,
  } = useGenerationLock();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<WizardFormData>({
    title: '',
    articleContent: '',
    slideCount: 1,
    illustrationStyle: DEFAULT_ILLUSTRATION_STYLE,
  });

  const steps: WizardStep[] = [
    {
      id: 'article',
      title: messages.newDeck.steps.article.title,
      description: mode === 'url' ? 'Import webpage' : mode === 'prompt' ? 'Describe topic' : messages.newDeck.steps.article.description,
    },
    {
      id: 'style',
      title: messages.newDeck.steps.style.title,
      description: messages.newDeck.steps.style.description,
    },
    {
      id: 'generate',
      title: messages.newDeck.steps.generate.title,
      description: messages.newDeck.steps.generate.description,
    },
  ];

  const canProceed = () => {
    if (currentStep === 0) {
      if (mode === 'url') {
         // Title holds the URL temporarily for validation
        return formData.title.trim().length > 5 && formData.title.startsWith('http');
      } else if (mode === 'prompt') {
        return formData.articleContent.trim().length >= 10;
      }
      // Text mode: title is auto-extracted from content, only require content
      return formData.articleContent.trim().length >= 10;
    }
    if (currentStep === 1) {
      return formData.illustrationStyle && formData.slideCount >= 1;
    }
    return true;
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1 && canProceed()) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStepClick = (step: number) => {
    if (step <= currentStep) {
      setCurrentStep(step);
    }
  };

  const updateFormData = (updates: WizardFormUpdate) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleModeChange = (nextMode: WizardMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    // The url mode repurposes `title` to hold the URL, so stale values from
    // another mode must never leak into the next submission.
    setFormData((prev) => ({ ...prev, title: '', articleContent: '' }));
  };


  return (
    <SecureConsoleFrame
      variant="focus"
      surface="wizard"
      panel={false}
      shellClassName="max-w-5xl"
      title={messages.newDeck.title}
      subtitle={messages.newDeck.subtitle}
      header={(
        <ConsoleHeader
          brandHref="/workspace"
          brandLabel="xArticle"
          contextLabel={messages.newDeck.title}
          actions={(
            <>
              <ThemeToggle />
            </>
          )}
        />
      )}
      footer={
        <>
          <span className="truncate font-mono text-[0.6rem] uppercase tracking-[0.12em]">ARTICLE BUILDER</span>
          <Link href="/workspace" className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
            {messages.common.backToDashboard}
          </Link>
        </>
      }
    >
      <div className="studio-wizard-canvas flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <ConsolePanel corners={false} className="bg-card/45 p-3 sm:p-4">
            <FrameCornerHandles />
            <div className="mb-1 border-b border-dotted border-border/70 pb-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em]">
              WORKFLOW / {messages.newDeck.stepCounter(currentStep + 1, steps.length)}
            </div>
            <div className="px-1 py-3 sm:px-3">
          <WizardStepper
            steps={steps}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
            </div>
          </ConsolePanel>

          <ConsolePanel corners={false} className="bg-card/70 p-3 sm:p-5 md:p-6">
            <FrameCornerHandles />
          {currentStep === 0 && (
            <>
              <div
                role="tablist"
                aria-label="Article source"
                className="mb-4 flex flex-wrap gap-1.5 border-b border-dotted border-border/70 pb-3"
              >
                {WIZARD_MODES.map((candidate) => (
                  <Button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === candidate.id}
                    size="sm"
                    variant={mode === candidate.id ? 'default' : 'outline'}
                    className="h-8 rounded-lg text-xs"
                    onClick={() => handleModeChange(candidate.id)}
                  >
                    {candidate.label}
                  </Button>
                ))}
              </div>
              {mode === 'url' && <UrlStep formData={formData} onUpdate={updateFormData} />}
              {mode === 'prompt' && (
                <PromptStep
                  formData={formData}
                  onUpdate={updateFormData}
                  generationLocked={generationLocked}
                  onUnlock={unlockGeneration}
                />
              )}
              {mode === 'text' && <ContentStep formData={formData} onUpdate={updateFormData} />}
            </>
          )}
          {currentStep === 1 && (
            <StyleStep formData={formData} onUpdate={updateFormData} />
          )}
          {currentStep === 2 && (
            <GenerateStep
              formData={formData}
              mode={mode}
              ready={!workspaceQuery.isLoading}
              generationLocked={generationLocked}
              onUnlock={unlockGeneration}
              onGenerationAccessLost={markGenerationAccessLost}
            />
          )}
          </ConsolePanel>

        {currentStep < 2 && (
          <div className="grid grid-cols-2 items-center gap-2 border-t border-dotted border-border/70 pt-4 sm:flex sm:justify-between sm:gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="h-10 w-full gap-2 rounded-lg sm:h-9 sm:w-auto"
            >
              <ChevronLeft className="h-4 w-4" />
              {messages.common.previous}
            </Button>

            <div className="hidden font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground sm:block">
              {messages.newDeck.stepCounter(currentStep + 1, steps.length)}
            </div>

            <Button
              size="sm"
              onClick={handleNext}
              disabled={!canProceed()}
              className="h-10 w-full gap-2 rounded-lg sm:h-9 sm:w-auto"
            >
              {currentStep === 1 ? messages.common.generate : messages.common.next}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        </div>
      </div>
    </SecureConsoleFrame>
  );
}

export default function NewDeckPage() {
  // useSearchParams requires a Suspense boundary in client pages.
  return (
    <Suspense fallback={null}>
      <NewDeckWizard />
    </Suspense>
  );
}
