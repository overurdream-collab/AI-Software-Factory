# P2 independent delivery retest

Owner reports enabling Actions PR creation. Retest on a fresh immutable v3 base, without restoring v1/v2 checkpoint or using the previous PR. Same independent acceptance tests and local inference, no paid API, no automatic merge or approval. A pass requires new PR created by Actions, exact head verification, durable delivered state and replay of the same PR. Inspect workflow logs and PR actor before acceptance. The prior assisted run remains unchanged. This commit is preparation, not proof of success.
