export interface Option {
  label: string;
  text: string;
  isCode: boolean;
  correct: boolean;
}

export interface Question {
  id: string;
  module: string;
  section: string;
  number: number;
  text: string;
  code: string | null;
  options: Option[];
  correctCount: number;
}

export interface SectionNode {
  section: string;
  count: number;
}

export interface ModuleNode {
  module: string;
  count: number;
  sections: SectionNode[];
}
