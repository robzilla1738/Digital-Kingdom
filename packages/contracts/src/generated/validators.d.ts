type V = ((data: unknown) => boolean) & { errors?: unknown[] | null };
export declare const validateGraph: V;
export declare const validateEvent: V;
export declare const validateIngestEvent: V;
export declare const validateSceneProposal: V;
export declare const validateWorldPlan: V;
export declare const validateRunProvenance: V;
export declare const validateVerificationReceipt: V;
export declare const validateCapabilityReceipt: V;
