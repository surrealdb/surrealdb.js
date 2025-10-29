import { InvalidSessionError } from "../errors";
import type { ConnectionSession, ConnectionState, Session } from "../types";

export function getSessionFromState(state: ConnectionState, session: Session): ConnectionSession {
    const sessionState = session ? state.sessions.get(session) : state.rootSession;

    if (!sessionState) {
        throw new InvalidSessionError(session);
    }

    return sessionState;
}
