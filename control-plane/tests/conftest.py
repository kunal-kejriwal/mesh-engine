import pytest
from app.engine.dijkstra import MeshGraph


@pytest.fixture
def six_node_graph() -> MeshGraph:
    """
    Reference topology matching the MeshEngine demo scenario:

        A ──(53.8ms)── B ──(53.8ms)──┐
        │                             D ──(50ms)── F
        └──(55.9ms)── C ──(55.9ms)──┘

    Shortest A→F: A→B→D→F  (157.6ms)
    After B fails: A→C→D→F (161.8ms)
    """
    g = MeshGraph()
    # Core path nodes
    g.add_edge("A", "B", 53.8)
    g.add_edge("A", "C", 55.9)
    g.add_edge("B", "C", 45.0)   # cross-link
    g.add_edge("B", "D", 53.8)
    g.add_edge("C", "D", 55.9)
    g.add_edge("D", "F", 50.0)
    # Side node E (not on primary path)
    g.add_edge("D", "E", 35.0)
    g.add_edge("E", "F", 60.0)
    return g
