Receive Webhooks from external services such as GitHub and Google Workspace. Events are relayed to the internal NAP through a public Relay endpoint.

## How it works

1. The external service sends the Webhook to the **public Relay URL**
2. Relay enqueues the event (SQS)
3. NAP polls the queue and processes the event locally

## Credentials

**Infrastructure (administrator-configured):**

- **Queue URL** — The SQS queue URL provided by the infrastructure team
- **Region** — The AWS region where the SQS queue is located, such as `us-east-1`
- **Access Key ID / Secret Access Key** — AWS Credentials used to poll the queue; can be left empty when using IAM Role

## Relay public URL

The public address of the Relay endpoint, such as `https://xxx.execute-api.us-east-1.amazonaws.com/v1`. Users see this address on the page when creating a Route and use it to configure the external service's Webhook.

## Public connector

Enable **Public connector** to let all users use this Connector. Users can create their own Routes on it without access to infrastructure Credentials.

## Next steps

After the Connector is created, create a **Route** for a specific endpoint path to define:
- Which path to listen to, such as `/github-push`
- Which Workspace to trigger for task execution
- Secret verification, supporting Plain and HMAC-SHA256 such as GitHub
- How to convert the request content into a prompt (template)
- Filter rules, processing only requests that match the conditions
