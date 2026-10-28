// The limits the server enforces on a username and password, so the form can say no first.
export const MIN_PASSWORD = 10
export const usernameOk = s => /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(String(s).trim().toLowerCase())
