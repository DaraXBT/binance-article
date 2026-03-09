'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WizardStepper, WizardStep } from '@/components/wizard-stepper';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentStep } from './steps/content-step';
import { SettingsStep } from './steps/settings-step';
import { ThemeStep } from './steps/theme-step';
import { GenerateStep } from './steps/generate-step';
import { useRouter } from 'next/navigation';

const STEPS: WizardStep[] = [
  { id: 'content', title: 'Content', description: 'Define your topic' },
  { id: 'settings', title: 'Settings', description: 'Configure deck' },
  { id: 'theme', title: 'Theme', description: 'Choose style' },
  { id: 'generate', title: 'Generate', description: 'Create deck' },
];

interface WizardFormData {
  title: string;
  topic: string;
  slideCount: number;
  targetAudience: string;
  style: string;
  additionalNotes: string;
  theme: string;
}

export default function NewDeckPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<WizardFormData>({
    title: '',
    topic: '',
    slideCount: 10,
    targetAudience: '',
    style: 'professional',
    additionalNotes: '',
    theme: 'default',
  });

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
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
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold mb-2">Create New Deck</h1>
          <p className="text-muted-foreground">
            Follow these steps to generate your AI-powered presentation
          </p>
        </div>

        {/* Stepper */}
        <div className="mb-12 px-4">
          <WizardStepper
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
        </div>

        {/* Step Content */}
        <div className="bg-card border border-border rounded-lg p-8 shadow-sm">
          {currentStep === 0 && (
            <ContentStep formData={formData} onUpdate={updateFormData} />
          )}
          {currentStep === 1 && (
            <SettingsStep formData={formData} onUpdate={updateFormData} />
          )}
          {currentStep === 2 && (
            <ThemeStep formData={formData} onUpdate={updateFormData} />
          )}
          {currentStep === 3 && (
            <GenerateStep formData={formData} onDone={() => router.push('/')} />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4 mt-8">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <div className="text-sm text-muted-foreground">
            Step {currentStep + 1} of {STEPS.length}
          </div>

          <Button
            onClick={handleNext}
            disabled={currentStep === STEPS.length - 1}
            className="gap-2"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
