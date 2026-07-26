export interface WizardFormData {
  title: string;
  articleContent: string;
  slideCount: number;
  illustrationStyle: string;
}

export type WizardFormUpdate = Partial<WizardFormData>;

export type WizardMode = 'text' | 'url' | 'prompt';
