Create a Webhook entry point that lets external systems trigger agent sessions through HTTP requests.

Webhook Connector does not require Credentials.

## Next steps

After the Connector is created, create a **Route** for a specific endpoint path to define:
- Which path to listen to, such as `/invoices`
- Which Workspace to trigger for task execution
- Secret verification, supporting Plain and HMAC-SHA256
- How to convert the request content into a prompt (template)
- Filter rules, processing only requests that match the conditions
