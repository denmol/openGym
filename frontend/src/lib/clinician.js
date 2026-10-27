// Clinician build (VITE_CLINICIAN_MODE=1) — for an instance used only by clinicians who make their own
// calls on diet and training. It switches off the screens that send medical flags to "ask a clinician":
// the nutrition safety review gate, the care-team-only target rule and the trainer's medical routing.
// It does not touch sign-in, the invite code or the checks that stop the AI inventing numbers.
// The server has the matching switch (CLINICIAN_MODE); set both together.
export const CLINICIAN = import.meta.env.VITE_CLINICIAN_MODE === '1'
