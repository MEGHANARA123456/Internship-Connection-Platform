from app.chatbot.provider_budget import ProviderBudget


def test_shared_and_per_user_reservations_cannot_be_exhausted_by_one_user() -> None:
    budget = ProviderBudget(
        tokens_per_minute=100,
        tokens_per_day=200,
        requests_per_minute=10,
        requests_per_day=20,
    )
    first, retry_after = budget.reserve("user-a", 50, 1)

    assert first is not None
    assert retry_after is None
    denied, retry_after = budget.reserve("user-a", 1, 1)
    assert denied is None
    assert retry_after is not None

    second, _ = budget.reserve("user-b", 50, 1)
    assert second is not None
    denied, retry_after = budget.reserve("user-c", 1, 1)
    assert denied is None
    assert retry_after is not None

    budget.settle(
        first,
        prompt_tokens=12,
        completion_tokens=8,
        total_tokens=20,
        retries=0,
        usage_reported=True,
    )
    replacement, retry_after = budget.reserve("user-a", 30, 1)
    assert replacement is not None
    assert retry_after is None
    assert budget.snapshot()["tokens_per_day"] == 20


def test_provider_cooldown_honors_retry_after() -> None:
    clock = [100.0]
    budget = ProviderBudget(
        tokens_per_minute=100,
        tokens_per_day=200,
        requests_per_minute=10,
        requests_per_day=20,
        now=lambda: clock[0],
    )
    budget.note_rate_limit(37)

    reservation, retry_after = budget.reserve("user-a", 1, 1)
    assert reservation is None
    assert retry_after == 37

    clock[0] += 38
    reservation, retry_after = budget.reserve("user-a", 1, 1)
    assert reservation is not None
    assert retry_after is None
