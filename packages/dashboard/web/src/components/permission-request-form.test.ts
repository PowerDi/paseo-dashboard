import { describe, expect, test } from "vitest";
import {
  arePermissionQuestionsAnswered,
  buildPermissionQuestionAnswers,
  buildPermissionActionResponse,
  buildPermissionQuestionResponse,
  buildRememberedPermissionResponse,
  getPermissionPlanText,
  parsePermissionQuestions,
  questionShowsFreeform,
  shouldSubmitEmptyPermissionQuestions,
  type PermissionQuestionSelections,
} from "./permission-request-form";

describe("permission request form", () => {
  test("parses provider question metadata used by Codex, Claude, OpenCode, Pi, and OMP", () => {
    expect(
      parsePermissionQuestions({
        questions: [
          {
            question: "Which provider?",
            header: "Provider",
            options: [{ label: "Claude", description: "Use Claude Code" }, { label: "Codex" }],
            multiSelect: true,
            allowOther: true,
            placeholder: "Name another provider",
          },
        ],
      }),
    ).toEqual([
      {
        question: "Which provider?",
        header: "Provider",
        options: [
          { label: "Claude", description: "Use Claude Code" },
          { label: "Codex", description: undefined },
        ],
        multiSelect: true,
        allowOther: true,
        allowEmpty: false,
        placeholder: "Name another provider",
        dismissLabel: undefined,
      },
    ]);
  });

  test("rejects malformed question payloads instead of sending an invalid response", () => {
    expect(
      parsePermissionQuestions({
        questions: [{ question: "Missing header", options: [] }],
      }),
    ).toBeNull();
    expect(parsePermissionQuestions({ questions: [] })).toBeNull();
  });

  test("builds comma-separated option answers and lets freeform replace a selection", () => {
    const questions = parsePermissionQuestions({
      questions: [
        {
          question: "Which providers?",
          header: "Providers",
          options: [{ label: "Claude" }, { label: "Codex" }],
          multiSelect: true,
        },
        {
          question: "Why?",
          header: "Reason",
          options: [{ label: "Speed" }],
          allowOther: true,
        },
      ],
    });
    expect(questions).not.toBeNull();

    const selections: PermissionQuestionSelections = {
      0: new Set([0, 1]),
      1: new Set([0]),
    };
    const freeform = { 1: "Better context" };

    expect(buildPermissionQuestionAnswers(questions!, selections, freeform)).toEqual({
      Providers: "Claude, Codex",
      Reason: "Better context",
    });
  });

  test("requires every non-optional question before allowing submit", () => {
    const questions = parsePermissionQuestions({
      questions: [
        {
          question: "Choose one",
          header: "Choice",
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          question: "Optional comment",
          header: "Comment",
          options: [],
          allowEmpty: true,
        },
      ],
    });
    expect(questions).not.toBeNull();
    expect(questionShowsFreeform(questions![1])).toBe(true);
    expect(arePermissionQuestionsAnswered(questions, {}, {})).toBe(false);
    expect(arePermissionQuestionsAnswered(questions, { 0: new Set([1]) }, {})).toBe(true);
  });

  test("preserves the provider input and serializes answers into updatedInput", () => {
    const input = {
      questions: [
        {
          question: "Which path?",
          header: "Path",
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
      providerField: "keep-me",
    };
    const questions = parsePermissionQuestions(input);
    expect(questions).not.toBeNull();

    expect(buildPermissionQuestionResponse(input, questions!, { 0: new Set([1]) }, {})).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { Path: "B" },
      },
    });
  });

  test("extracts reviewable plan text from provider metadata or input", () => {
    expect(
      getPermissionPlanText({
        id: "plan-1",
        provider: "codex",
        name: "CodexPlanApproval",
        kind: "plan",
        input: { plan: "Input plan" },
        metadata: { planText: "Metadata plan" },
      }),
    ).toBe("Metadata plan");
    expect(
      getPermissionPlanText({
        id: "plan-2",
        provider: "claude",
        name: "ExitPlanMode",
        kind: "plan",
        input: { plan: "Input plan" },
      }),
    ).toBe("Input plan");
  });

  test("preserves provider action ids and permission suggestions in responses", () => {
    expect(
      buildPermissionActionResponse(
        { id: "dismiss", label: "Dismiss", behavior: "deny", intent: "dismiss" },
        "Denied by user",
      ),
    ).toEqual({
      behavior: "deny",
      selectedActionId: "dismiss",
      message: "Denied by user",
    });

    const suggestions = [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test" }],
        behavior: "allow",
        destination: "session",
      },
    ];
    expect(buildRememberedPermissionResponse(suggestions)).toEqual({
      behavior: "allow",
      updatedPermissions: suggestions,
    });
  });

  test("optional free-write prompts submit an empty answer instead of rejecting", () => {
    const questions = parsePermissionQuestions({
      questions: [
        {
          question: "Optional comment",
          header: "Comment",
          options: [],
          allowEmpty: true,
          dismissLabel: "Skip",
        },
      ],
    });
    expect(questions).not.toBeNull();
    expect(shouldSubmitEmptyPermissionQuestions(questions!)).toBe(true);
    expect(buildPermissionQuestionAnswers(questions!, {}, {})).toEqual({ Comment: "" });
  });
});
