export interface Option {
  label: string;
  text: string;
  isCode: boolean;
  correct: boolean;
}

export interface Block {
  type: "text" | "code" | "image";
  value: string;
}

export interface Question {
  id: string;
  module: string;
  section: string;
  number: number;
  /** Ordered content blocks: prose, code, and figures. */
  content: Block[];
  /** Plain-text join of the prose blocks (for search & previews). */
  text: string;
  options: Option[];
  correctCount: number;
  explanation?: string;
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
