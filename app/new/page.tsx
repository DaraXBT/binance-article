'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<WizardFormData>({
    title: '',
    articleContent: '',
    slideCount: 1,
    illustrationStyle: 'pixel-art',
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
        return formData.title.trim().length >= 1 && formData.articleContent.trim().length >= 10;
      }
      return formData.title.trim().length >= 1 && formData.articleContent.trim().length >= 10;
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/10">
      <div className="mx-auto w-full px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            ← {messages.common.backToDashboard}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="mb-12">
          <h1 className="mb-2 text-3xl font-bold">{messages.newDeck.title}</h1>
          <p className="text-muted-foreground">
            {messages.newDeck.subtitle}
          </p>
        </div>

        <div className="mb-6 sm:mb-12 px-2 sm:px-4">
          <WizardStepper
            steps={steps}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4 sm:p-6 md:p-8 shadow-sm">
          {currentStep === 0 && (
            <>
              {mode === 'url' && <UrlStep formData={formData} onUpdate={updateFormData} />}
              {mode === 'prompt' && <PromptStep formData={formData} onUpdate={updateFormData} />}
              {mode === 'text' && <ContentStep formData={formData} onUpdate={updateFormData} />}
            </>
          )}
          {currentStep === 1 && (
            <StyleStep formData={formData} onUpdate={updateFormData} />
          )}
          {currentStep === 2 && (
            <GenerateStep formData={formData} mode={mode as any} />
          )}
        </div>

        {currentStep < 2 && (
          <div className="flex items-center justify-between gap-4 mt-8">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              {messages.common.previous}
            </Button>

            <div className="text-sm text-muted-foreground">
              {messages.newDeck.stepCounter(currentStep + 1, steps.length)}
            </div>

            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="gap-2"
            >
              {currentStep === 1 ? messages.common.generate : messages.common.next}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
