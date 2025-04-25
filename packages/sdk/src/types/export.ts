export interface ExportOptions {
	users: boolean;
	accesses: boolean;
	params: boolean;
	functions: boolean;
	analyzers: boolean;
	versions: boolean;
	tables: boolean | string[];
	records: boolean;
}
