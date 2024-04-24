class Config {
	private _flatMode: boolean = false;

	get flatMode(): boolean {
		return this._flatMode;
	}

	set flatMode(value: boolean) {
		this._flatMode = value;
	}
}

const config = new Config();
export default config;
