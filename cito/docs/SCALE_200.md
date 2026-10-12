# Cito 200-Host Scale Gate

Cito v1 targets 200 hosts. The deterministic scale regression constructs 200 remote coordinator summaries and validates the inverse DemandKey -> candidate CoordinatorId index.

The CI does not create 200 network namespaces. Algorithm/index scale is simulated locally; real namespace tests validate network correctness on smaller representative topologies. Physical p99/throughput claims remain real multi-machine work.
