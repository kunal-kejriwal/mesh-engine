class MeshEngineException(Exception):
    """Base exception for all MeshEngine domain errors."""

    def __init__(self, message: str, code: str = "MESH_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


class NodeNotFoundException(MeshEngineException):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node '{node_id}' not found", "NODE_NOT_FOUND")


class NodeDownException(MeshEngineException):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node '{node_id}' is DOWN", "NODE_DOWN")


class NetworkNotFoundException(MeshEngineException):
    def __init__(self, network_id: str) -> None:
        super().__init__(f"Network '{network_id}' not found", "NETWORK_NOT_FOUND")


class NoRouteException(MeshEngineException):
    def __init__(self, source: str, destination: str) -> None:
        super().__init__(
            f"No route available from '{source}' to '{destination}'",
            "NO_ROUTE",
        )


class MessageNotFoundException(MeshEngineException):
    def __init__(self, message_id: str) -> None:
        super().__init__(f"Message '{message_id}' not found", "MESSAGE_NOT_FOUND")
