from fastapi.testclient import TestClient

from app.main import app, handler


def test_health_returns_ok():
    res = TestClient(app).get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "rapport-api"
    assert {"version", "environment"} <= body.keys()


def test_lambda_handler_serves_http_api_event():
    # Minimal API Gateway HTTP API (payload v2) event, as the Lambda receives it.
    event = {
        "version": "2.0",
        "routeKey": "ANY /api/{proxy+}",
        "rawPath": "/api/health",
        "rawQueryString": "",
        "headers": {"host": "example.cloudfront.net"},
        "requestContext": {
            "http": {"method": "GET", "path": "/api/health", "sourceIp": "1.2.3.4"},
            "stage": "$default",
        },
        "isBase64Encoded": False,
    }
    res = handler(event, None)
    assert res["statusCode"] == 200
    assert '"status":"ok"' in res["body"]
