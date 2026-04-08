"""
Unit tests for the Dijkstra routing engine.

These tests are pure-Python and require no database or Redis connection.
They validate correctness of:
- Shortest path selection
- Node failure exclusion
- Self-healing reroute after recovery
- Edge cases (unreachable, single node, direct link)
"""
import math
import pytest
from app.engine.dijkstra import MeshGraph


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def make_linear_graph(n: int, weight: float = 10.0) -> MeshGraph:
    """Create a simple chain: 0 → 1 → 2 → … → n-1"""
    g = MeshGraph()
    for i in range(n - 1):
        g.add_edge(str(i), str(i + 1), weight)
    return g


# ────────────────────────────────────────────────────────────────────────────
# Basic routing
# ────────────────────────────────────────────────────────────────────────────

def test_direct_link(six_node_graph):
    path, cost = six_node_graph.dijkstra("A", "B")
    assert path == ["A", "B"]
    assert math.isclose(cost, 53.8, abs_tol=0.01)


def test_shortest_path_a_to_f(six_node_graph):
    path, cost = six_node_graph.dijkstra("A", "F")
    # A→B→D→F = 53.8 + 53.8 + 50 = 157.6ms
    assert path == ["A", "B", "D", "F"]
    assert math.isclose(cost, 157.6, abs_tol=0.01)


def test_path_start_and_end(six_node_graph):
    path, _ = six_node_graph.dijkstra("A", "F")
    assert path[0] == "A"
    assert path[-1] == "F"


def test_same_source_destination(six_node_graph):
    path, cost = six_node_graph.dijkstra("A", "A")
    assert path == ["A"]
    assert cost == 0.0


def test_linear_chain_full_path():
    g = make_linear_graph(5, weight=10.0)
    path, cost = g.dijkstra("0", "4")
    assert path == ["0", "1", "2", "3", "4"]
    assert math.isclose(cost, 40.0)


def test_linear_chain_mid_path():
    g = make_linear_graph(5, weight=10.0)
    path, cost = g.dijkstra("1", "3")
    assert path == ["1", "2", "3"]
    assert math.isclose(cost, 20.0)


# ────────────────────────────────────────────────────────────────────────────
# Node failure
# ────────────────────────────────────────────────────────────────────────────

def test_fail_node_b_reroutes_through_c(six_node_graph):
    """Core self-healing scenario: B fails → route switches to A→C→D→F"""
    six_node_graph.fail_node("B")
    path, cost = six_node_graph.dijkstra("A", "F")

    assert path is not None
    assert "B" not in path
    assert path[0] == "A"
    assert path[-1] == "F"
    # A→C→D→F = 55.9 + 55.9 + 50 = 161.8ms
    assert math.isclose(cost, 161.8, abs_tol=0.01)


def test_fail_source_returns_no_route(six_node_graph):
    six_node_graph.fail_node("A")
    path, cost = six_node_graph.dijkstra("A", "F")
    assert path is None
    assert cost == float("inf")


def test_fail_destination_returns_no_route(six_node_graph):
    six_node_graph.fail_node("F")
    path, cost = six_node_graph.dijkstra("A", "F")
    assert path is None


def test_fail_all_intermediaries_no_route(six_node_graph):
    for node in ["B", "C"]:
        six_node_graph.fail_node(node)
    path, _ = six_node_graph.dijkstra("A", "F")
    assert path is None


def test_fail_side_node_does_not_affect_primary_path(six_node_graph):
    """Failing E should NOT change the A→F primary route."""
    six_node_graph.fail_node("E")
    path, cost = six_node_graph.dijkstra("A", "F")
    assert path == ["A", "B", "D", "F"]
    assert math.isclose(cost, 157.6, abs_tol=0.01)


# ────────────────────────────────────────────────────────────────────────────
# Self-healing: recovery
# ────────────────────────────────────────────────────────────────────────────

def test_recover_node_restores_optimal_path(six_node_graph):
    six_node_graph.fail_node("B")
    # Verify detour is active
    path_detour, _ = six_node_graph.dijkstra("A", "F")
    assert "B" not in path_detour

    # Recover B
    six_node_graph.recover_node("B")
    path_restored, cost = six_node_graph.dijkstra("A", "F")
    assert path_restored == ["A", "B", "D", "F"]
    assert math.isclose(cost, 157.6, abs_tol=0.01)


def test_recover_restores_previously_isolated_segment():
    g = MeshGraph()
    g.add_edge("X", "Y", 5.0)
    g.add_edge("Y", "Z", 5.0)

    g.fail_node("Y")
    path, _ = g.dijkstra("X", "Z")
    assert path is None

    g.recover_node("Y")
    path, cost = g.dijkstra("X", "Z")
    assert path == ["X", "Y", "Z"]
    assert math.isclose(cost, 10.0)


# ────────────────────────────────────────────────────────────────────────────
# Edge cases
# ────────────────────────────────────────────────────────────────────────────

def test_unknown_source_returns_no_route():
    g = MeshGraph()
    g.add_edge("A", "B", 1.0)
    path, cost = g.dijkstra("Z", "B")
    assert path is None
    assert cost == float("inf")


def test_unknown_destination_returns_no_route():
    g = MeshGraph()
    g.add_edge("A", "B", 1.0)
    path, cost = g.dijkstra("A", "Z")
    assert path is None


def test_isolated_node_unreachable():
    g = MeshGraph()
    g.add_node("isolated")
    g.add_edge("A", "B", 1.0)
    path, _ = g.dijkstra("A", "isolated")
    assert path is None


def test_prefers_lower_weight_path():
    g = MeshGraph()
    # Two paths: direct (expensive) vs indirect (cheap)
    g.add_edge("A", "B", 100.0)         # direct, costly
    g.add_edge("A", "X", 1.0)           # via X — cheap
    g.add_edge("X", "B", 1.0)
    path, cost = g.dijkstra("A", "B")
    assert path == ["A", "X", "B"]
    assert math.isclose(cost, 2.0)


def test_node_count_and_active_count():
    g = MeshGraph()
    g.add_edge("A", "B", 1.0)
    g.add_edge("B", "C", 1.0)
    assert g.node_count() == 3
    assert g.active_node_count() == 3

    g.fail_node("B")
    assert g.active_node_count() == 2


def test_edge_weight_lookup():
    g = MeshGraph()
    g.add_edge("A", "B", 42.5)
    assert g.edge_weight("A", "B") == 42.5
    assert g.edge_weight("B", "A") == 42.5  # bidirectional
    assert g.edge_weight("A", "C") is None


def test_directional_edge():
    g = MeshGraph()
    g.add_edge("A", "B", 10.0, bidirectional=False)
    path_forward, _ = g.dijkstra("A", "B")
    path_reverse, _ = g.dijkstra("B", "A")
    assert path_forward == ["A", "B"]
    assert path_reverse is None
