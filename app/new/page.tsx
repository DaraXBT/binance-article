'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ConsolePanel,
  FrameCornerHandles,
  SecureConsoleFrame,
} from '@/components/console/secure-console-frame';
import { LanguageToggle } from '@/components/language-toggle';
import { useLanguage } from '@/components/language-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { WizardStepper, WizardStep } from '@/components/wizard-stepper';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentStep } from './steps/content-step';
import { StyleStep } from './steps/style-step';
import { GenerateStep } from './steps/generate-step';
import { UrlStep } from './steps/url-step';
import { PromptStep } from './steps/prompt-step';
import { useWorkspace } from '@/lib/hooks';

interface WizardFormData {
  title: string;
  articleContent: string;
  slideCount: number;
  illustrationStyle: string;
}

export default function NewDeckPage() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') || 'text'; // 'url', 'prompt', or 'text'
  const { messages } = useLanguage();
  const { data: workspace, refetch: refetchWorkspace } = useWorkspace();
  const [currentStep, setCurrentStep] = useState(0);
  const [hasGenerationAccess, setHasGenerationAccess] = useState(
    workspace?.hasGenerationAccess ?? false
  );
  const [formData, setFormData] = useState<WizardFormData>({
    title: '',
    articleContent: '',
    slideCount: 1,
    illustrationStyle: 'pixel-art',
  });
  const generationLocked = Boolean(workspace?.generateAccessEnabled && !hasGenerationAccess);

  useEffect(() => {
    setHasGenerationAccess(workspace?.hasGenerationAccess ?? false);
  }, [workspace?.hasGenerationAccess]);

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

  const updateFormData = (updates: Partial<WizardFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleGenerationUnlock = () => {
    setHasGenerationAccess(true);
    void refetchWorkspace();
  };

  const handleGenerationAccessLost = () => {
    setHasGenerationAccess(false);
    void refetchWorkspace();
  };

  return (
    <SecureConsoleFrame
      variant="focus"
      panel={false}
      eyebrow="ARTICLE BUILDER / FOCUS MODE"
      title={messages.newDeck.title}
      subtitle={messages.newDeck.subtitle}
      statuses={[
        { label: 'DRAFT', value: formData.articleContent.trim() ? 'EDITING' : 'EMPTY', tone: formData.articleContent.trim() ? 'action' : 'neutral' },
        { label: 'STEP', value: `${currentStep + 1}/3`, tone: 'action' },
        { label: 'WORKSPACE', value: workspace?.hasWorkspace ? 'READY' : 'CHECK', tone: workspace?.hasWorkspace ? 'success' : 'warning' },
        { label: 'AI ACCESS', value: generationLocked ? 'LOCKED' : 'READY', tone: generationLocked ? 'warning' : 'success' },
      ]}
      header={
        <header className="console-header">
          <Link href="/workspace" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex size-8 shrink-0 items-center justify-center border border-foreground/80 bg-foreground text-background">
              XA
            </span>
            <span className="truncate max-[350px]:hidden">xArticle / new</span>
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>
      }
      footer={
        <>
          <span className="truncate font-mono text-[0.6rem] uppercase tracking-[0.12em]">ARTICLE BUILDER</span>
          <Link href="/workspace" className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
            {messages.common.backToDashboard}
          </Link>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <ConsolePanel corners={false} className="bg-card/45 p-3 sm:p-4">
            <FrameCornerHandles className="size-2.5 bg-card" />
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
            <FrameCornerHandles className="size-2.5 bg-card" />
          {currentStep === 0 && (
            <>
              {mode === 'url' && <UrlStep formData={formData} onUpdate={updateFormData} />}
              {mode === 'prompt' && (
                <PromptStep
                  formData={formData}
                  onUpdate={updateFormData}
                  generationLocked={generationLocked}
                  onUnlock={handleGenerationUnlock}
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
              mode={mode as any}
              generationLocked={generationLocked}
              onUnlock={handleGenerationUnlock}
              onGenerationAccessLost={handleGenerationAccessLost}
            />
          )}
          </ConsolePanel>

        {currentStep < 2 && (
          <div className="flex items-center justify-between gap-4 border-t border-dotted border-border/70 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="h-9 gap-2 rounded-none border-dotted"
            >
              <ChevronLeft className="h-4 w-4" />
              {messages.common.previous}
            </Button>

            <div className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
              {messages.newDeck.stepCounter(currentStep + 1, steps.length)}
            </div>

            <Button
              size="sm"
              onClick={handleNext}
              disabled={!canProceed()}
              className="h-9 gap-2 rounded-none"
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
