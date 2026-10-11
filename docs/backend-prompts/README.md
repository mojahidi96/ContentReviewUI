# Backend prompts

Every UI change that needs a change in the Node.js **ContentReviewService** has a prompt file here.
Give the file to the backend (paste it into a Claude Code session opened in the ContentReviewService
repo, or hand it to its developer). The UI, the mock API (`mock-server/`) and
[`../api-contract.md`](../api-contract.md) already implement the same contract, so the three stay in
sync.

## Rules

1. **New or changed backend need → new or updated file here**, in the same change as the UI code.
   Never describe a backend requirement only in chat or in a code comment.
2. Files are numbered in the order they were written (`NN-topic.md`) and are self-contained: a
   reader who has not seen the UI must be able to implement them.
3. Each file starts with a **Status** line. Update it when the backend ships (and note the Node
   version or branch).
4. Keep the wire shapes identical to `api-contract.md`, the mock server and the `*Dto` types in
   `src/app/**/**.models.ts`. When one changes, change all of them and this file.
5. Mark anything the mock implements but Node does not as 🟡 proposed in `api-contract.md`.

## Index

| # | Prompt | UI feature | Status |
| --- | --- | --- | --- |
| 01 | [OTP sign-in and password reset](01-otp-login-and-password-reset.md) | `/login/code`, `/forgot-password` | Needs backend |
| 02 | [Review models and failure details](02-review-models-and-failure-details.md) | Model picker, quota/timeout banner | Backend implemented (per team); keep as reference |
| 03 | [Refresh token and sliding session](03-refresh-token.md) | No surprise "session expired" while working | Needs backend |
