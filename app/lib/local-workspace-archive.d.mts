export function businessDay(value?: Date | string): string;
export function keepLocalQuotes(userId: number, records: { id: string; revision: number }[], database?: IDBFactory): Promise<boolean>;
export function keepLocalWorkspace(userId: number, snapshot: { state: unknown; clientState?: unknown; revision?: string | null; updatedAt?: string }, options?: { storage?: Pick<Storage, "getItem" | "setItem">; database?: IDBFactory }): Promise<boolean>;
