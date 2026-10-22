type V = ((data: unknown) => boolean) & { errors?: unknown[] | null };
export declare const validateGraph: V;
export declare const validateEvent: V;
export declare const validateIngestEvent: V;
export declare const validateSceneProposal: V;
