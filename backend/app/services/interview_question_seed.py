"""Idempotently seed the draft text interview question bank."""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, engine
from app.models import InterviewQuestionBank


_QUESTION_SETS: dict[str, dict[str, tuple[tuple[str, str], ...]]] = {
    "HR": {
        "BEGINNER": (
            ("Tell me about yourself and what you are studying.", "Give a short introduction, then connect one interest to this internship."),
            ("Why are you interested in this internship?", "Mention one thing you want to learn and one way you can contribute."),
            ("What do you know about the role you applied for?", "Refer to a responsibility or skill in the role description."),
            ("Which skill are you most confident using?", "Name a specific example where you used the skill."),
            ("What would you like to learn during an internship?", "Choose a practical goal and how you would seek feedback."),
            ("What kind of team helps you do your best work?", "Describe a useful team habit and how you contribute to it."),
            ("How do you organize your schoolwork and project tasks?", "Explain a simple planning method and how you track deadlines."),
            ("What would you do if you did not understand a task?", "Describe how you would clarify the goal before starting."),
            ("How do you respond when you receive feedback?", "Explain how you listen, clarify, and apply useful feedback."),
            ("What questions would you ask at the end of an interview?", "Ask about success expectations, mentoring, or the team's work."),
        ),
        "INTERMEDIATE": (
            ("Describe how you chose between two internship opportunities.", "Compare the learning goals, responsibilities, and practical constraints."),
            ("How would you explain a technical project to a non-technical teammate?", "Start with the problem and outcome, then avoid unnecessary jargon."),
            ("Tell me about a time you had to learn a tool quickly.", "Give the context, your learning plan, and how you checked your progress."),
            ("How would you raise a concern about an unrealistic deadline?", "Explain the impact, propose options, and ask which trade-off matters most."),
            ("What would you do if your assigned work seemed less important than another task?", "Confirm priorities with the owner rather than silently switching tasks."),
            ("How do you decide when to ask for help?", "Describe the attempt you make first and the evidence you bring when asking."),
            ("How would you handle a disagreement about project responsibilities?", "Clarify ownership and expectations, then agree on a documented plan."),
            ("What does professional communication mean in a remote or hybrid team?", "Cover timely updates, clear written context, and respectful follow-through."),
            ("How would you prepare for your first week in a new team?", "Set learning goals, confirm access and onboarding, meet teammates, and prepare role-specific questions."),
            ("Tell me about a decision you made with incomplete information.", "Explain what you knew, the risk you accepted, and how you checked the result."),
        ),
        "ADVANCED": (
            ("How would you balance a learning opportunity with a high-priority team deliverable?", "Describe how you would surface the trade-off and align on priorities."),
            ("A project sponsor asks for a commitment you cannot confidently make. What do you say?", "Be transparent about uncertainty, assumptions, and the next validation step."),
            ("How would you handle receiving conflicting feedback from two reviewers?", "Look for shared goals, ask for examples, and agree who owns the final decision."),
            ("What would you do if you noticed a team process excluding a quieter teammate?", "Check in respectfully, invite their perspective, suggest inclusive ways to participate, and follow up."),
            ("How would you communicate a mistake that may affect a delivery date?", "Share impact early, propose mitigation, and keep updates factual."),
            ("How do you decide whether to optimize for speed or quality on an internship task?", "Explain how you assess reversibility, user impact, and acceptance criteria."),
            ("How would you respond if a task's success criteria changed near completion?", "Reconfirm the new goal, estimate the impact, and agree on scope."),
            ("How would you protect focus while remaining responsive to your team?", "Set clear communication windows and escalate urgent work through agreed channels."),
            ("What would you do if you were asked to present work you did not personally verify?", "State what is verified, identify uncertainty, and avoid overstating results."),
            ("How would you evaluate whether an internship is helping you grow?", "Use agreed goals, regular feedback, and examples of increased responsibility."),
        ),
    },
    "TECHNICAL": {
        "BEGINNER": (
            ("Explain the difference between a list and a set in a programming language you know.", "Compare ordering, duplicate handling, and a simple use case."),
            ("What happens when a browser sends an HTTP GET request?", "Describe the request, server response, status code, and returned data."),
            ("How would you find a syntax error in a small program?", "Use the error location, inspect nearby code, and run a minimal reproduction."),
            ("What is a function, and why might you use one?", "Explain inputs, a named responsibility, and reuse or testability."),
            ("How would you read a value from a JSON response?", "Mention parsing, checking that the key exists, and handling an unexpected value."),
            ("What is the purpose of a primary key in a database table?", "Describe unique row identity and how other tables can reference it."),
            ("How would you test a form that requires an email address?", "Try valid input, malformed input, empty input, and boundary cases."),
            ("What is the difference between an array index and an array value?", "Use a small example and note common off-by-one mistakes."),
            ("Why should an application validate user input?", "Mention correctness, clear errors, and preventing unsafe or malformed data."),
            ("What information would you include in a useful bug report?", "Include reproduction steps, expected and actual behavior, and environment details."),
        ),
        "INTERMEDIATE": (
            ("How would you diagnose an API endpoint that became much slower?", "Compare timings, inspect logs and query plans, then isolate the bottleneck."),
            ("How would you prevent duplicate form submissions when a user clicks twice?", "Consider client feedback plus an idempotency key or server-side uniqueness."),
            ("Describe how you would design pagination for a large result set.", "Compare offset and cursor pagination, stable sorting, and response limits."),
            ("How would you investigate a database query that returns duplicate rows?", "Check join cardinality, constraints, and whether aggregation is needed."),
            ("How do you decide what belongs in a unit test versus an integration test?", "Focus on isolation for unit tests and boundaries for integration tests."),
            ("How would you handle a dependency that intermittently times out?", "Use bounded timeouts, safe retry rules, observability, and graceful failure."),
            ("What trade-offs would you consider when caching API responses?", "Discuss freshness, invalidation, cache keys, and data ownership."),
            ("How would you make a background task safe to retry?", "Use idempotent operations, persisted state, and bounded retry handling."),
            ("How would you review a pull request that changes a public API response?", "Check callers, compatibility, validation, tests, and documented behavior."),
            ("How would you debug a race condition that appears only under load?", "Reproduce concurrency, identify shared state, and test atomicity or locking."),
        ),
        "ADVANCED": (
            ("Design a strategy for safely deploying a schema change used by two application versions.", "Use an expand-migrate-contract sequence and verify rollback compatibility."),
            ("How would you handle a queue consumer that processes the same message more than once?", "Explain idempotency keys, transaction boundaries, and delivery semantics."),
            ("A service's p95 latency is acceptable but p99 is very high. How do you investigate?", "Segment traces, inspect tail causes, and compare dependency and resource saturation."),
            ("How would you design authorization for a resource with multiple owners and roles?", "Start from a trusted identity, define resource-level policy, and test denial paths."),
            ("How would you protect a database from a sudden spike of expensive search requests?", "Discuss query limits, indexes, rate limits, timeouts, and load shedding."),
            ("How would you migrate a high-write table without blocking normal traffic?", "Plan a compatible schema, backfill in batches, dual-read/write carefully, and monitor."),
            ("How would you reason about consistency when an operation spans two services?", "Explain the lack of a shared transaction and outline compensation or an outbox."),
            ("How would you investigate memory growth in a long-running API process?", "Use profiling and object-retention evidence, then verify under a repeatable workload."),
            ("How would you design a rate limiter that works across multiple backend instances?", "Compare shared atomic storage, time windows, key design, and failure policy."),
            ("How would you review whether a proposed abstraction is worth adding?", "Weigh repeated use, complexity, change boundaries, and simpler alternatives."),
        ),
    },
    "DATA_SCIENCE": {
        "BEGINNER": (
            ("How would you explain the difference between a feature and a label?", "Use a simple prediction example and identify the target being predicted."),
            ("What is the difference between a mean and a median?", "Explain how outliers affect each and when each summary is useful."),
            ("How would you inspect a dataset before analyzing it?", "Check shape, types, missing values, ranges, and a few representative rows."),
            ("What does a train-test split help you measure?", "Explain evaluating on examples not used to fit the model."),
            ("How would you interpret a positive correlation between two variables?", "Describe association while noting that correlation alone does not prove causation."),
            ("What is a missing value, and how might you handle one?", "First determine why it is missing, then compare removal or imputation choices."),
            ("How would you summarize a chart for a teammate?", "State the measure, comparison, notable pattern, and important caveat."),
            ("What is a classification problem?", "Give an example with discrete outcomes and a possible evaluation measure."),
            ("Why should data types be checked before computing statistics?", "Explain that parsing and units affect correctness and interpretation."),
            ("How would you detect an obvious data-entry error in a numeric column?", "Check valid ranges, units, distributions, and source records."),
        ),
        "INTERMEDIATE": (
            ("How would you detect target leakage in a predictive model?", "Trace feature availability to prediction time and review the data pipeline."),
            ("When might precision matter more than recall, and vice versa?", "Tie the trade-off to the costs of false positives and false negatives."),
            ("How would you compare a baseline model with a more complex model?", "Use the same split, appropriate metrics, uncertainty, and operational cost."),
            ("How would you evaluate a model when classes are highly imbalanced?", "Consider precision-recall, class-specific metrics, and a realistic baseline."),
            ("What can a confidence interval tell you about an estimate?", "Explain uncertainty under assumptions, rather than a probability for a fixed parameter."),
            ("How would you choose a strategy for missing non-random data?", "Investigate the missingness mechanism and assess bias from candidate treatments."),
            ("How would you explain a model's performance to a product manager?", "Connect metrics to user outcomes, baseline performance, and limitations."),
            ("How would you validate a time-series forecast?", "Use chronological splits and prevent future information from entering features."),
            ("What is regularization, and why can it help?", "Describe penalizing complexity to reduce overfitting, with a tuning caveat."),
            ("How would you investigate a model whose performance fell after deployment?", "Check data drift, label delay, pipeline changes, and evaluation consistency."),
        ),
        "ADVANCED": (
            ("How would you design an evaluation for a model used by different user groups?", "Define group metrics, uncertainty, sample adequacy, and harm review."),
            ("How would you separate covariate shift from a change in the target relationship?", "Compare feature distributions, conditional behavior, labels, and data collection."),
            ("How would you evaluate a recommender when users only interact with shown items?", "Discuss exposure bias, counterfactual methods, online tests, and guardrails."),
            ("How would you decide whether an A/B test has enough evidence to stop?", "Define the estimand, power, stopping plan, practical effect, and safety checks."),
            ("How would you monitor a model when ground-truth labels arrive weeks later?", "Combine leading data-quality signals with delayed, versioned outcome metrics."),
            ("How would you assess whether a feature is stable enough for a production model?", "Check temporal and subgroup stability, leakage, availability, and maintenance cost."),
            ("How would you handle a model that improves average accuracy but harms one group?", "Quantify the trade-off, investigate causes, and apply policy before deployment."),
            ("How would you estimate uncertainty for a metric on correlated observations?", "Choose resampling or inference that respects the sampling and grouping structure."),
            ("How would you distinguish a useful causal estimate from a predictive association?", "State the intervention and assumptions, then consider confounding and design."),
            ("How would you govern reproducibility across training and inference pipelines?", "Version data, code, features, parameters, artifacts, and evaluation records."),
        ),
    },
    "BEHAVIORAL": {
        "BEGINNER": (
            ("Tell me about a group project you contributed to.", "Describe your role, one action, and the result for the team."),
            ("Describe a time you had to meet a deadline.", "Explain how you planned the work and communicated progress."),
            ("Tell me about something new you learned recently.", "Share the learning goal, practice method, and what you can do now."),
            ("Describe a time you helped a teammate.", "Explain what they needed and how you supported their progress."),
            ("Tell me about a mistake you made while learning.", "Focus on how you noticed it, corrected it, and changed your approach."),
            ("Describe a time you received feedback on your work.", "State the feedback and one specific improvement you made."),
            ("Tell me about a task you found challenging.", "Explain how you broke it into steps and asked for help when appropriate."),
            ("Describe how you handle several small tasks at once.", "Give an example of how you prioritized and tracked completion."),
            ("Tell me about a time you took initiative.", "Describe a useful action you took and how you checked it was welcome."),
            ("What is one strength you bring to a team?", "Support the strength with a concrete example rather than a general claim."),
        ),
        "INTERMEDIATE": (
            ("Tell me about a disagreement on a team and how you handled it.", "Explain the different views, how you listened, and the agreed outcome."),
            ("Describe a project that did not go as planned.", "State the setback, your response, and what you would change next time."),
            ("Tell me about a time you had to influence without formal authority.", "Describe the shared goal, evidence, and how you invited input."),
            ("Give an example of balancing quality with a deadline.", "Explain your prioritization, risks communicated, and final trade-off."),
            ("Tell me about a time you changed your mind after seeing new evidence.", "Describe the initial view, the evidence, and the resulting decision."),
            ("Describe how you supported a teammate who was blocked.", "Explain how you understood the blocker and helped without taking over."),
            ("Tell me about a goal you did not meet.", "Be specific about the gap, accountability, and your next plan."),
            ("Describe a time you had to communicate an unpopular decision.", "Explain the rationale, acknowledge trade-offs, invite concerns, and describe your follow-through."),
            ("Tell me about a task where the requirements were ambiguous.", "Describe how you clarified assumptions and confirmed the expected outcome."),
            ("Give an example of adapting to a change in priorities.", "Explain what changed and how you reset commitments with others."),
        ),
        "ADVANCED": (
            ("Describe a time you surfaced a risk that others had overlooked.", "Explain how you verified the risk and communicated it constructively."),
            ("Tell me about a decision where you had to balance competing stakeholder needs.", "Identify the constraints, trade-offs, and how you made the rationale clear."),
            ("Describe how you responded when your work was criticized publicly.", "Focus on staying constructive, checking the substance, and following up."),
            ("Tell me about a time you helped improve a team process.", "Explain the problem, how you involved the team, and how you measured impact."),
            ("Describe a situation where you had to deliver difficult feedback.", "Explain how you used specific observations and made room for response."),
            ("Tell me about a commitment you had to renegotiate.", "Describe how early you communicated, what changed, and how you restored trust."),
            ("How have you handled a situation where team norms conflicted with your values?", "Explain how you assessed the issue and chose an appropriate, safe escalation path."),
            ("Describe a time you made a decision with significant uncertainty.", "State what was knowable, the reversible choice, and how you monitored results."),
            ("Tell me about a time you helped a group recover after a setback.", "Describe how you clarified next steps and maintained shared accountability."),
            ("How do you make sure your contributions are visible without taking credit from others?", "Explain transparent updates, attribution, and inviting others to share outcomes."),
        ),
    },
}


_CATEGORY_RUBRICS = {
    "HR": "Assess clarity, relevance to the role, reflection, and realistic communication.",
    "TECHNICAL": "Assess correctness, reasoning, trade-offs, and a clear explanation of the approach.",
    "DATA_SCIENCE": "Assess statistical reasoning, assumptions, evaluation choices, and clear interpretation.",
    "BEHAVIORAL": "Assess a specific example, the candidate's own actions, reflection, and outcome.",
}


async def seed_interview_question_bank(db: AsyncSession) -> int:
    existing = {
        question.seed_key: question
        for question in (await db.scalars(select(InterviewQuestionBank))).all()
    }
    inserted = 0
    for category, difficulties in _QUESTION_SETS.items():
        for difficulty, questions in difficulties.items():
            for index, (prompt, hint) in enumerate(questions, start=1):
                seed_key = f"{category.lower()}-{difficulty.lower()}-{index:02d}-v1"
                if seed_key in existing:
                    question = existing[seed_key]
                    metadata = question.source_metadata
                    if (
                        metadata.get("status") == "DRAFT-for-review"
                        and metadata.get("source") == "InternSphere initial seed"
                        and metadata.get("seed_version") == 1
                    ):
                        question.prompt = prompt
                        question.hint = hint
                        question.rubric = _CATEGORY_RUBRICS[category]
                    continue
                question = InterviewQuestionBank(
                    seed_key=seed_key,
                    category=category,
                    difficulty=difficulty,
                    prompt=prompt,
                    hint=hint,
                    rubric=_CATEGORY_RUBRICS[category],
                    active=True,
                    source_metadata={
                        "status": "DRAFT-for-review",
                        "source": "InternSphere initial seed",
                        "seed_version": 1,
                    },
                )
                db.add(question)
                existing[seed_key] = question
                inserted += 1
    await db.commit()
    return inserted


async def main() -> None:
    async with async_session_factory() as db:
        inserted = await seed_interview_question_bank(db)
    await engine.dispose()
    print(f"Interview question bank seeded; inserted={inserted}.")


if __name__ == "__main__":
    asyncio.run(main())
