export type ToolCategory = 'data' | 'text' | 'encoding' | 'datetime' | 'developer' | 'crypto';
export type OptionValue = string | number | boolean;
export interface ToolOption {
  key: string;
  label: string;
  type: 'select' | 'text' | 'textarea' | 'number' | 'checkbox';
  defaultValue: OptionValue;
  choices?: { label: string; value: string }[];
  description?: string;
  min?: number;
  max?: number;
}
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  keywords: string[];
  icon: string;
  inputLabel?: string;
  secondaryInputLabel?: string;
  sampleInput: string;
  sampleSecondaryInput?: string;
  options: ToolOption[];
  actions: { id: string; label: string }[];
  defaultAction: string;
  extension?: string;
  supportsBatch?: boolean;
}
export interface ToolRequest {
  toolId: string;
  action: string;
  input: string;
  secondaryInput?: string;
  options: Record<string, OptionValue>;
}
export interface ToolResult {
  output: string;
  summary?: string;
  warnings?: string[];
  kind?: 'text' | 'json' | 'diff';
  diff?: { type: 'equal' | 'add' | 'remove'; text: string }[];
  stats?: Record<string, string | number>;
}
