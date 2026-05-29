# express-api

Generated: 2026-05-29T08:19:14.686Z

## Project

- Languages: Node.js/TypeScript
- Framework hints: None detected
- Files scanned: 3
- Endpoints extracted: 6

## Endpoint Catalog

| Method | Path | Summary | Auth | Confidence | Source |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | Login user | No | 1 | openapi.json:1 |
| GET | `/legacy` | Legacy endpoint no longer in code | No | 1 | openapi.json:1 |
| GET | `/users` | List users | Yes | 0.72 | src/routes/users.js:7 |
| POST | `/users` | Create users | Yes | 0.72 | src/routes/users.js:29 |
| DELETE | `/users/{id}` | Delete users | Yes | 0.72 | src/routes/users.js:44 |
| GET | `/users/{id}` | Get users | Yes | 0.72 | src/routes/users.js:18 |

## POST /auth/login

Imported from existing OpenAPI specification.

- Operation ID: `createAuthLogin`
- Tags: auth
- Auth required: no
- Confidence: 1

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| None detected |  |  |  |  |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |

## GET /legacy

Imported from existing OpenAPI specification.

- Operation ID: `listLegacy`
- Tags: legacy
- Auth required: no
- Confidence: 1

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| None detected |  |  |  |  |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |

## GET /users

GET /users endpoint extracted from source code. Request body fields were inferred from validation and body access patterns. Observed response codes: 200, 201, 204, 400, 404, 422, 500.

- Operation ID: `listUsers`
- Tags: users
- Auth required: yes
- Confidence: 0.72

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| query | limit | integer | no | Query parameter limit. |
| query | page | integer | no | Query parameter page. |

### Body Fields

| Name | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| email | integer | yes | "user@example.com" | Request body field email. |
| name | integer | yes | "user@example.com" | Request body field name. |
| password | integer | yes | "user@example.com" | Request body field password. |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 204 | No content |
| 400 | Validation error |
| 404 | Not found |
| 422 | Unprocessable entity |
| 500 | Internal server error |

### Error Codes

| Code | Message | Resolution |
| --- | --- | --- |
| INVALID_USER_ID | Invalid User Id | Check the request data, authentication, and referenced resource state. |
| USER_NOT_FOUND | User Not Found | Check the request data, authentication, and referenced resource state. |
| VALIDATION_ERROR | Validation Error | Check the request data, authentication, and referenced resource state. |

## POST /users

POST /users endpoint extracted from source code. Request body fields were inferred from validation and body access patterns. Observed response codes: 200, 201, 204, 400, 404, 422, 500.

- Operation ID: `createUsers`
- Tags: users
- Auth required: yes
- Confidence: 0.72

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| query | limit | integer | no | Query parameter limit. |
| query | page | integer | no | Query parameter page. |

### Body Fields

| Name | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| email | integer | yes | "user@example.com" | Request body field email. |
| name | integer | yes | "user@example.com" | Request body field name. |
| password | integer | yes | "user@example.com" | Request body field password. |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 204 | No content |
| 400 | Validation error |
| 404 | Not found |
| 422 | Unprocessable entity |
| 500 | Internal server error |

### Error Codes

| Code | Message | Resolution |
| --- | --- | --- |
| INVALID_USER_ID | Invalid User Id | Check the request data, authentication, and referenced resource state. |
| USER_NOT_FOUND | User Not Found | Check the request data, authentication, and referenced resource state. |
| VALIDATION_ERROR | Validation Error | Check the request data, authentication, and referenced resource state. |

## DELETE /users/{id}

DELETE /users/{id} endpoint extracted from source code. Request body fields were inferred from validation and body access patterns. Observed response codes: 200, 201, 204, 400, 404, 422, 500.

- Operation ID: `deleteUsersId`
- Tags: users
- Auth required: yes
- Confidence: 0.72

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| path | id | integer | yes | Path parameter id. |

### Body Fields

| Name | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| email | integer | yes | "user@example.com" | Request body field email. |
| name | integer | yes | "user@example.com" | Request body field name. |
| password | integer | yes | "user@example.com" | Request body field password. |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 204 | No content |
| 400 | Validation error |
| 404 | Not found |
| 422 | Unprocessable entity |
| 500 | Internal server error |

### Error Codes

| Code | Message | Resolution |
| --- | --- | --- |
| USER_NOT_FOUND | User Not Found | Check the request data, authentication, and referenced resource state. |
| VALIDATION_ERROR | Validation Error | Check the request data, authentication, and referenced resource state. |
| INVALID_USER_ID | Invalid User Id | Check the request data, authentication, and referenced resource state. |

## GET /users/{id}

GET /users/{id} endpoint extracted from source code. Request body fields were inferred from validation and body access patterns. Observed response codes: 200, 201, 204, 400, 404, 422, 500.

- Operation ID: `getUsersId`
- Tags: users
- Auth required: yes
- Confidence: 0.72

### Request

| Location | Name | Type | Required | Description |
| --- | --- | --- | --- | --- |
| path | id | integer | yes | Path parameter id. |
| query | limit | integer | no | Query parameter limit. |
| query | page | integer | no | Query parameter page. |

### Body Fields

| Name | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| email | integer | yes | "user@example.com" | Request body field email. |
| name | integer | yes | "user@example.com" | Request body field name. |
| password | integer | yes | "user@example.com" | Request body field password. |

### Responses

| Status | Description |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 204 | No content |
| 400 | Validation error |
| 404 | Not found |
| 422 | Unprocessable entity |
| 500 | Internal server error |

### Error Codes

| Code | Message | Resolution |
| --- | --- | --- |
| INVALID_USER_ID | Invalid User Id | Check the request data, authentication, and referenced resource state. |
| USER_NOT_FOUND | User Not Found | Check the request data, authentication, and referenced resource state. |
| VALIDATION_ERROR | Validation Error | Check the request data, authentication, and referenced resource state. |

## Drift Report

- New in code: 4
- Removed from spec: 1
- Changed: 1