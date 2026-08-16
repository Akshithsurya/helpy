<?php

declare(strict_types=1);

/**
 * Represents the outcome of a validation process.
 */
final class ValidationResult
{
    /**
     * @param bool $isValid Whether the validation passed without any critical errors.
     * @param list<string> $errors Critical issues that invalidate the plan.
     * @param list<string> $warnings Non-critical issues that should be reviewed.
     * @param list<string> $suggestions Optional recommendations for improvement.
     * @param list<string> $fixes Actionable steps to resolve errors or warnings.
     */
    public function __construct(
        public readonly bool $isValid,
        public readonly array $errors = [],
        public readonly array $warnings = [],
        public readonly array $suggestions = [],
        public readonly array $fixes = []
    ) {}

    public static function success(): self
    {
        return new self(isValid: true);
    }

    /**
     * @param list<string> $errors
     * @param list<string> $fixes
     */
    public static function fail(array $errors = [], array $fixes = []): self
    {
        return new self(isValid: false, errors: $errors, fixes: $fixes);
    }

    /**
     * Checks if the validation has any critical errors.
     */
    public function hasErrors(): bool
    {
        return !empty($this->errors);
    }

    /**
     * Checks if the validation has any non-critical notices (warnings or suggestions).
     */
    public function hasNotices(): bool
    {
        return !empty($this->warnings) || !empty($this->suggestions);
    }

    /**
     * Combines multiple validation results into one.
     */
    public function merge(ValidationResult ...$others): self
    {
        $errors = $this->errors;
        $warnings = $this->warnings;
        $suggestions = $this->suggestions;
        $fixes = $this->fixes;
        $isValid = $this->isValid;

        foreach ($others as $other) {
            $errors = array_merge($errors, $other->errors);
            $warnings = array_merge($warnings, $other->warnings);
            $suggestions = array_merge($suggestions, $other->suggestions);
            $fixes = array_merge($fixes, $other->fixes);
            $isValid = $isValid && $other->isValid;
        }

        return new self(
            isValid: $isValid,
            errors: $errors,
            warnings: $warnings,
            suggestions: $suggestions,
            fixes: $fixes
        );
    }

    /**
     * Creates a new ValidationResult from an array of existing results.
     */
    public static function combine(ValidationResult ...$results): self
    {
        if (empty($results)) {
            return self::success();
        }

        $first = array_shift($results);
        return $first->merge(...$results);
    }
}

/**
 * Represents a structured issue with an associated fix message.
 */
final class ValidationIssue
{
    private function __construct(
        public readonly string $message,
        public readonly string $fix
    ) {}

    public static function create(string $message, string $fix): self
    {
        return new self($message, $fix);
    }
}

/**
 * Validates a plan array against business rules.
 */
final class PlanValidator
{
    private const MAX_TITLE_LENGTH = 100;
    private const MAX_GOAL_LENGTH = 500;
    private const MAX_TAGS_COUNT = 10;
    private const MAX_TAG_LENGTH = 30;
    
    private const DEFAULT_MIN_DURATION = 15;
    private const DEFAULT_MAX_DURATION = 240;

    /** @var list<ValidationIssue> */
    private array $errors = [];
    /** @var list<ValidationIssue> */
    private array $warnings = [];
    /** @var list<ValidationIssue> */
    private array $suggestions = [];

    /**
     * Validates the given plan array.
     *
     * @param array<string, mixed> $plan
     */
    public static function validate(
        array $plan,
        ?int $minDuration = null,
        ?int $maxDuration = null
    ): ValidationResult {
        $validator = new self(
            $plan, 
            $minDuration ?? self::DEFAULT_MIN_DURATION, 
            $maxDuration ?? self::DEFAULT_MAX_DURATION
        );
        
        return $validator->execute();
    }

    private function __construct(
        private readonly array $plan,
        private readonly int $minDuration,
        private readonly int $maxDuration
    ) {}

    private function execute(): ValidationResult
    {
        $this->validateTitle();
        $this->validateGoal();
        $this->validateDuration();
        $this->validateTags();

        return new ValidationResult(
            isValid: empty($this->errors),
            errors: array_map(fn(ValidationIssue $issue) => $issue->message, $this->errors),
            warnings: array_map(fn(ValidationIssue $issue) => $issue->message, $this->warnings),
            suggestions: array_map(fn(ValidationIssue $issue) => $issue->message, $this->suggestions),
            fixes: array_map(fn(ValidationIssue $issue) => $issue->fix, array_merge($this->errors, $this->warnings, $this->suggestions))
        );
    }

    private function addError(string $message, string $fix): void
    {
        $this->errors[] = ValidationIssue::create($message, $fix);
    }

    private function addWarning(string $message, string $fix): void
    {
        $this->warnings[] = ValidationIssue::create($message, $fix);
    }

    private function addSuggestion(string $message, string $fix): void
    {
        $this->suggestions[] = ValidationIssue::create($message, $fix);
    }

    private function validateTitle(): void
    {
        $title = trim((string)($this->plan['title'] ?? ''));
        
        if ($title === '') {
            $this->addError('Plan title cannot be empty.', 'Add a descriptive title to the plan.');
            return;
        }

        if (mb_strlen($title, 'UTF-8') > self::MAX_TITLE_LENGTH) {
            $this->addError(
                sprintf('Plan title is too long (maximum %d characters).', self::MAX_TITLE_LENGTH),
                'Shorten the plan title.'
            );
        }
    }

    private function validateGoal(): void
    {
        $goal = trim((string)($this->plan['goal'] ?? ''));
        
        if ($goal === '') {
            $this->addWarning(
                'Plan goal is empty.', 
                'Consider adding a goal to provide context for the plan.'
            );
            return;
        }

        if (mb_strlen($goal, 'UTF-8') > self::MAX_GOAL_LENGTH) {
            $this->addError(
                sprintf('Plan goal is too long (maximum %d characters).', self::MAX_GOAL_LENGTH),
                'Shorten the plan goal.'
            );
        }
    }

    private function validateDuration(): void
    {
        $duration = $this->plan['durationMinutes'] ?? null;
        
        if ($duration === null || $duration === '') {
            $this->addWarning(
                'Plan duration is not specified.', 
                'Specify the duration of the plan in minutes.'
            );
            return;
        }

        if (!is_numeric($duration)) {
            $this->addError(
                'Plan duration must be a valid number.', 
                'Provide duration as a numeric value in minutes.'
            );
            return;
        }

        $duration = (int)$duration;

        if ($duration < 1) {
            $this->addError(
                'Plan duration must be at least 1 minute.',
                'Set the duration to a positive number of minutes.'
            );
            return;
        }

        if ($duration < $this->minDuration) {
            $this->addWarning(
                sprintf('Suggested duration is at least %d minutes.', $this->minDuration),
                sprintf('Increase duration to at least %d minutes.', $this->minDuration)
            );
        } elseif ($duration > $this->maxDuration) {
            $this->addWarning(
                sprintf('Suggested duration is no more than %d minutes.', $this->maxDuration),
                sprintf('Decrease duration to %d minutes or less.', $this->maxDuration)
            );
        }
    }

    private function validateTags(): void
    {
        $tags = $this->plan['tags'] ?? [];
        
        if (!is_array($tags)) {
            $this->addError(
                'Tags must be provided as an array.', 
                'Format the tags as a list/array of strings.'
            );
            return;
        }

        if (count($tags) > self::MAX_TAGS_COUNT) {
            $this->addWarning(
                sprintf('Too many tags provided (maximum %d).', self::MAX_TAGS_COUNT),
                'Reduce the number of tags to the most relevant ones.'
            );
        }

        $seenTags = [];
        foreach ($tags as $index => $tag) {
            if (!is_string($tag) && !is_numeric($tag)) {
                $this->addError(
                    sprintf('Tag at index %d must be a string or number.', $index),
                    'Ensure all tags are valid strings or numbers.'
                );
                continue;
            }

            $tagString = trim(strtolower((string)$tag));
            
            if ($tagString === '') {
                $this->addWarning(
                    sprintf('Tag at index %d is empty.', $index),
                    'Remove empty tags or provide a meaningful value.'
                );
                continue;
            }

            if (in_array($tagString, $seenTags, true)) {
                $this->addWarning(
                    sprintf('Duplicate tag found: "%s".', $tagString),
                    sprintf('Remove the duplicate tag "%s".', $tagString)
                );
                continue;
            }
            $seenTags[] = $tagString;

            $tagLength = mb_strlen($tagString, 'UTF-8');
            if ($tagLength > self::MAX_TAG_LENGTH) {
                $this->addWarning(
                    sprintf("Tag '%s' is too long (maximum %d characters).", $tagString, self::MAX_TAG_LENGTH),
                    sprintf("Shorten or remove the tag '%s'.", $tagString)
                );
            }

            if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $tagString)) {
                $this->addSuggestion(
                    sprintf("Tag '%s' does not follow standard formatting.", $tagString),
                    "Consider using lowercase letters, numbers, and hyphens for consistency (e.g., 'my-tag')."
                );
            }
        }
    }
}