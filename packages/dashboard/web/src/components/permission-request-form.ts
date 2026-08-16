import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionUpdate,
} from "@getpaseo/protocol/agent-types";

export interface PermissionQuestionOption {
  label: string;
  description?: string;
}

export interface PermissionQuestion {
  question: string;
  header: string;
  options: PermissionQuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
}

export type PermissionQuestionSelections = Record<number, ReadonlySet<number>>;
export type PermissionQuestionFreeform = Record<number, string>;

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function parsePermissionQuestions(input: unknown): PermissionQuestion[] | null {
  if (typeof input !== "object" || input === null) return null;
  const rawQuestions = (input as Record<string, unknown>).questions;
  if (!Array.isArray(rawQuestions)) return null;

  const questions: PermissionQuestion[] = [];
  for (const item of rawQuestions) {
    if (typeof item !== "object" || item === null) return null;
    const rawQuestion = item as Record<string, unknown>;
    if (typeof rawQuestion.question !== "string" || typeof rawQuestion.header !== "string") {
      return null;
    }
    if (!Array.isArray(rawQuestion.options)) return null;

    const options: PermissionQuestionOption[] = [];
    for (const item of rawQuestion.options) {
      if (typeof item !== "object" || item === null) return null;
      const rawOption = item as Record<string, unknown>;
      if (typeof rawOption.label !== "string") return null;
      options.push({
        label: rawOption.label,
        description: optionalString(rawOption, "description"),
      });
    }

    questions.push({
      question: rawQuestion.question,
      header: rawQuestion.header,
      options,
      multiSelect: rawQuestion.multiSelect === true,
      allowOther: rawQuestion.allowOther === true || rawQuestion.isOther === true,
      allowEmpty: rawQuestion.allowEmpty === true,
      placeholder: optionalString(rawQuestion, "placeholder"),
      dismissLabel: optionalString(rawQuestion, "dismissLabel"),
    });
  }

  return questions.length > 0 ? questions : null;
}

export function questionShowsFreeform(question: PermissionQuestion): boolean {
  return question.options.length === 0 || question.allowOther;
}

export function isPermissionQuestionAnswered(
  question: PermissionQuestion,
  questionIndex: number,
  selections: PermissionQuestionSelections,
  freeform: PermissionQuestionFreeform,
): boolean {
  if ((selections[questionIndex]?.size ?? 0) > 0) return true;
  if (!questionShowsFreeform(question)) return false;
  if ((freeform[questionIndex]?.trim().length ?? 0) > 0) return true;
  return question.allowEmpty;
}

export function arePermissionQuestionsAnswered(
  questions: PermissionQuestion[] | null,
  selections: PermissionQuestionSelections,
  freeform: PermissionQuestionFreeform,
): boolean {
  return (
    questions?.every((question, index) =>
      isPermissionQuestionAnswered(question, index, selections, freeform),
    ) ?? false
  );
}

export function buildPermissionQuestionAnswers(
  questions: PermissionQuestion[],
  selections: PermissionQuestionSelections,
  freeform: PermissionQuestionFreeform,
): Record<string, string> {
  const answers: Record<string, string> = {};

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const text = freeform[index]?.trim();
    if (questionShowsFreeform(question) && text) {
      answers[question.header] = text;
      continue;
    }
    if (question.allowEmpty && question.options.length === 0) {
      answers[question.header] = "";
      continue;
    }

    const selected = selections[index];
    if (selected && selected.size > 0) {
      answers[question.header] = Array.from(selected)
        .map((optionIndex) => question.options[optionIndex]?.label)
        .filter((label): label is string => label !== undefined)
        .join(", ");
    }
  }

  return answers;
}

export function buildPermissionQuestionResponse(
  input: Record<string, unknown> | undefined,
  questions: PermissionQuestion[],
  selections: PermissionQuestionSelections,
  freeform: PermissionQuestionFreeform,
): AgentPermissionResponse {
  return {
    behavior: "allow",
    updatedInput: {
      ...input,
      answers: buildPermissionQuestionAnswers(questions, selections, freeform),
    },
  };
}

export function shouldSubmitEmptyPermissionQuestions(questions: PermissionQuestion[]): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) => question.allowEmpty && question.options.length === 0)
  );
}

export function getPermissionPlanText(request: AgentPermissionRequest): string | null {
  const metadataPlan = request.metadata?.planText;
  if (typeof metadataPlan === "string" && metadataPlan.trim().length > 0) return metadataPlan;

  const inputPlan = request.input?.plan;
  if (typeof inputPlan === "string" && inputPlan.trim().length > 0) return inputPlan;

  if (request.detail?.type === "plan" && request.detail.text.trim().length > 0) {
    return request.detail.text;
  }
  return null;
}

export function buildPermissionActionResponse(
  action: AgentPermissionAction,
  denialMessage: string,
): AgentPermissionResponse {
  if (action.behavior === "allow") {
    return { behavior: "allow", selectedActionId: action.id };
  }
  return {
    behavior: "deny",
    selectedActionId: action.id,
    message: denialMessage,
  };
}

export function buildRememberedPermissionResponse(
  suggestions: readonly AgentPermissionUpdate[],
): AgentPermissionResponse {
  return {
    behavior: "allow",
    updatedPermissions: [...suggestions],
  };
}
