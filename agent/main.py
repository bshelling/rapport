"""AgentCore Runtime entry point for the Rapport assistant."""

import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from rapport_agent.core import handle

logging.basicConfig(level=logging.INFO)
app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload, context):
    return handle(payload)


if __name__ == "__main__":
    app.run()
