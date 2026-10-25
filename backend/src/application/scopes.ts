/** Escopos de desafio: um desafio emitido para um contexto não vale em outro. */
/** Matrícula: ainda não há usuário; o desafio fica preso à instalação que o pediu. */
export const enrollChallengeScope = (installationId: string): string => `enroll:${installationId}`;
export const CHALLENGE_TTL_SECONDS = 120;
export const presenceChallengeScope = (userId: string, eventId: string): string => `presence:${userId}:${eventId}`;
