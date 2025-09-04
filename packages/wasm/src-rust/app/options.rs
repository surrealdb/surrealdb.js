use crate::err::Error;
use serde::Deserialize;
use std::collections::HashSet;
use surrealdb::dbs::capabilities;

#[derive(Deserialize)]
pub struct Options {
	pub strict: Option<bool>,
	pub query_timeout: Option<u8>,
	pub transaction_timeout: Option<u8>,
	pub capabilities: Option<CapabilitiesConfig>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum CapabilitiesConfig {
	Bool(bool),
	Capabilities {
		scripting: Option<bool>,
		guest_access: Option<bool>,
		live_query_notifications: Option<bool>,
		functions: Option<Targets>,
		network_targets: Option<Targets>,
		experimental: Option<Targets>,
	},
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum Targets {
	Bool(bool),
	Array(HashSet<String>),
	Config {
		allow: Option<TargetsConfig>,
		deny: Option<TargetsConfig>,
	},
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum TargetsConfig {
	Bool(bool),
	Array(HashSet<String>),
}

macro_rules! process_targets {
	($set:ident) => {{
		let mut functions = HashSet::with_capacity($set.len());
		for function in $set {
			functions.insert(function.parse().expect("invalid function name"));
		}
		capabilities::Targets::Some(functions)
	}};
}

impl TryFrom<CapabilitiesConfig> for capabilities::Capabilities {
	type Error = Error;

	fn try_from(config: CapabilitiesConfig) -> Result<Self, Self::Error> {
		let caps = match config {
			CapabilitiesConfig::Bool(true) => Self::all(),
			CapabilitiesConfig::Bool(false) => {
				Self::default().with_functions(capabilities::Targets::None)
			}
			CapabilitiesConfig::Capabilities {
				scripting,
				guest_access,
				live_query_notifications,
				functions,
				network_targets,
				experimental,
			} => {
				let mut capabilities = Self::default();

				if let Some(scripting) = scripting {
					capabilities = capabilities.with_scripting(scripting);
				}

				if let Some(guest_access) = guest_access {
					capabilities = capabilities.with_guest_access(guest_access);
				}

				if let Some(live_query_notifications) = live_query_notifications {
					capabilities =
						capabilities.with_live_query_notifications(live_query_notifications);
				}

				if let Some(functions) = functions {
					match functions {
						Targets::Bool(functions) => match functions {
							true => {
								capabilities =
									capabilities.with_functions(capabilities::Targets::All);
							}
							false => {
								capabilities =
									capabilities.with_functions(capabilities::Targets::None);
							}
						},
						Targets::Array(set) => {
							capabilities = capabilities.with_functions(process_targets!(set));
						}
						Targets::Config {
							allow,
							deny,
						} => {
							if let Some(config) = allow {
								match config {
									TargetsConfig::Bool(functions) => match functions {
										true => {
											capabilities = capabilities
												.with_functions(capabilities::Targets::All);
										}
										false => {
											capabilities = capabilities
												.with_functions(capabilities::Targets::None);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities =
											capabilities.with_functions(process_targets!(set));
									}
								}
							}

							if let Some(config) = deny {
								match config {
									TargetsConfig::Bool(functions) => match functions {
										true => {
											capabilities = capabilities
												.without_functions(capabilities::Targets::All);
										}
										false => {
											capabilities = capabilities
												.without_functions(capabilities::Targets::None);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities =
											capabilities.without_functions(process_targets!(set));
									}
								}
							}
						}
					}
				}

				if let Some(network_targets) = network_targets {
					match network_targets {
						Targets::Bool(network_targets) => match network_targets {
							true => {
								capabilities =
									capabilities.with_network_targets(capabilities::Targets::All);
							}
							false => {
								capabilities =
									capabilities.with_network_targets(capabilities::Targets::None);
							}
						},
						Targets::Array(set) => {
							capabilities = capabilities.with_network_targets(process_targets!(set));
						}
						Targets::Config {
							allow,
							deny,
						} => {
							if let Some(config) = allow {
								match config {
									TargetsConfig::Bool(network_targets) => match network_targets {
										true => {
											capabilities = capabilities
												.with_network_targets(capabilities::Targets::All);
										}
										false => {
											capabilities = capabilities
												.with_network_targets(capabilities::Targets::None);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities = capabilities
											.with_network_targets(process_targets!(set));
									}
								}
							}

							if let Some(config) = deny {
								match config {
									TargetsConfig::Bool(network_targets) => match network_targets {
										true => {
											capabilities = capabilities.without_network_targets(
												capabilities::Targets::All,
											);
										}
										false => {
											capabilities = capabilities.without_network_targets(
												capabilities::Targets::None,
											);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities = capabilities
											.without_network_targets(process_targets!(set));
									}
								}
							}
						}
					}
				}

				if let Some(experimental) = experimental {
					match experimental {
						Targets::Bool(experimental) => match experimental {
							true => {
								capabilities =
									capabilities.with_experimental(capabilities::Targets::All);
							}
							false => {
								capabilities =
									capabilities.with_experimental(capabilities::Targets::None);
							}
						},
						Targets::Array(set) => {
							capabilities = capabilities.with_experimental(process_targets!(set));
						}
						Targets::Config {
							allow,
							deny,
						} => {
							if let Some(config) = allow {
								match config {
									TargetsConfig::Bool(experimental) => match experimental {
										true => {
											capabilities = capabilities
												.with_experimental(capabilities::Targets::All);
										}
										false => {
											capabilities = capabilities
												.with_experimental(capabilities::Targets::None);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities = capabilities
											.with_experimental(process_targets!(set));
									}
								}
							}

							if let Some(config) = deny {
								match config {
									TargetsConfig::Bool(experimental) => match experimental {
										true => {
											capabilities = capabilities.without_experimental(
												capabilities::Targets::All,
											);
										}
										false => {
											capabilities = capabilities.without_experimental(
												capabilities::Targets::None,
											);
										}
									},
									TargetsConfig::Array(set) => {
										capabilities = capabilities
											.without_experimental(process_targets!(set));
									}
								}
							}
						}
					}
				}

				capabilities
			}
		};

		Ok(
			caps
				// Always allow arbitrary quering in the WASM SDK,
				// There is no use in configuring that here
				.with_arbitrary_query(capabilities::Targets::All)
				.without_arbitrary_query(capabilities::Targets::None)
		)
	}
}
