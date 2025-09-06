extern crate napi_build;
use std::fs;

fn main() {
	napi_build::setup();

	let cargo_lock = fs::read_to_string("Cargo.lock").expect("Unable to read Cargo.toml");
	let lock: cargo_lock::Lockfile = cargo_lock.parse().expect("Failed to parse Cargo.lock");
	let package = lock
		.packages
		.iter()
		.find(|p| {
			let name = p.name.as_str();

			name == "surrealdb" || name == "surrealdb-beta" || name == "surrealdb-alpha"
		})
		.expect("Failed to find surrealdb in Cargo.lock");

	let version =
		format!("{}.{}.{}", package.version.major, package.version.minor, package.version.patch);

	println!("cargo:rustc-env=SURREALDB_VERSION={}", version);
}
