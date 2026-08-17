window.__ModuleLoader__.load({
	id: "dsh-deepseek-vision",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region lib/client/card.js
		/** One labeled text/select control of the card. */
		function Field(props) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "vlgt-field",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "vlgt-field-head",
						children: [
							(0, react_jsx_runtime.jsx)("label", {
								className: "vlgt-label",
								htmlFor: props.id,
								children: props.label
							}),
							props.overridden && (0, react_jsx_runtime.jsx)("span", {
								className: "vlgt-badge",
								children: props.overriddenLabel
							}),
							!props.noReset && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vlgt-reset",
								disabled: props.disabled || !props.overridden && props.text === "",
								onClick: props.onReset,
								children: props.resetLabel
							})
						]
					}),
					props.type === "select" && props.choices !== void 0 ? (0, react_jsx_runtime.jsxs)("select", {
						id: props.id,
						className: "vlgt-input",
						disabled: props.disabled,
						value: props.text,
						onChange: (event) => {
							props.onEdit(event.target.value);
						},
						children: [(0, react_jsx_runtime.jsx)("option", { value: "" }), props.choices.map((choice) => (0, react_jsx_runtime.jsx)("option", {
							value: choice,
							children: choice
						}, choice))]
					}) : (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						className: "vlgt-input",
						type: props.type ?? "text",
						disabled: props.disabled,
						value: props.text,
						onChange: (event) => {
							props.onEdit(event.target.value);
						}
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: "vlgt-hint",
						children: props.invalid ? props.invalidLabel : props.hint
					})
				]
			});
		}
		/**
		* Render the VL gateway card.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the card.
		*/
		function VlGatewayCard(props) {
			const { t } = props;
			const state = props.useVlGatewayCard((snapshot) => snapshot);
			if (!state.available) return null;
			const disabled = !state.writable;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "vlgt-card",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "vlgt-head",
						children: [(0, react_jsx_runtime.jsx)("h3", {
							className: "vlgt-title",
							children: t("title")
						}), (0, react_jsx_runtime.jsx)("p", {
							className: "vlgt-description",
							children: t("description")
						})]
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-apiKey",
						label: t("apiKey"),
						hint: t("apiKeyHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						type: "password",
						noReset: true,
						text: state.apiKey.text,
						overridden: state.apiKey.overridden,
						invalid: state.apiKey.invalid,
						disabled: !state.apiKeyWritable,
						onEdit: (text) => {
							props.edit("apiKey", text);
						},
						onReset: () => {
							props.edit("apiKey", "");
						}
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: "vlgt-hint",
						children: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset")
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-apiKeyEnv",
						label: t("apiKeyEnv"),
						hint: t("apiKeyEnvHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.apiKeyEnv,
						onEdit: (text) => {
							props.edit("apiKeyEnv", text);
						},
						onReset: () => {
							props.resetField("apiKeyEnv");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-baseURL",
						label: t("baseURL"),
						hint: t("baseURLHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.baseURL,
						onEdit: (text) => {
							props.edit("baseURL", text);
						},
						onReset: () => {
							props.resetField("baseURL");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-model",
						label: t("model"),
						hint: t("modelHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.model,
						onEdit: (text) => {
							props.edit("model", text);
						},
						onReset: () => {
							props.resetField("model");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-describePrompt",
						label: t("describePrompt"),
						hint: t("describePromptHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.describePrompt,
						onEdit: (text) => {
							props.edit("describePrompt", text);
						},
						onReset: () => {
							props.resetField("describePrompt");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-timeoutMs",
						label: t("timeoutMs"),
						hint: t("timeoutMsHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						type: "number",
						disabled,
						...state.timeoutMs,
						onEdit: (text) => {
							props.edit("timeoutMs", text);
						},
						onReset: () => {
							props.resetField("timeoutMs");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-maxCacheEntries",
						label: t("maxCacheEntries"),
						hint: t("maxCacheEntriesHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						type: "number",
						disabled,
						...state.maxCacheEntries,
						onEdit: (text) => {
							props.edit("maxCacheEntries", text);
						},
						onReset: () => {
							props.resetField("maxCacheEntries");
						}
					}),
					(0, react_jsx_runtime.jsx)(Field, {
						id: "vlgt-onFailure",
						label: t("onFailure"),
						hint: t("onFailureHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidChoice"),
						type: "select",
						choices: ["fail", "placeholder"],
						disabled,
						...state.onFailure,
						onEdit: (text) => {
							props.edit("onFailure", text);
						},
						onReset: () => {
							props.resetField("onFailure");
						}
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "vlgt-actions",
						children: [
							state.failed && (0, react_jsx_runtime.jsx)("span", {
								className: "vlgt-failed",
								children: t("saveFailed")
							}),
							state.saving && (0, react_jsx_runtime.jsx)("span", {
								className: "vlgt-hint",
								children: t("saving")
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vlgt-button vlgt-button-primary",
								disabled: disabled || !state.dirty || state.invalid || state.saving,
								onClick: props.save,
								children: t("save")
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vlgt-button",
								disabled: !state.dirty || state.saving,
								onClick: props.discard,
								children: t("discard")
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region lib/client/form.js
		/**
		* Compact card form model for the VL gateway settings card.
		*
		* This mirrors the official `dsh-client-ui-settings-plugins` card-form model
		* (staged drafts, presence marks overrides, invalid drafts block the save) —
		* an out-of-tree client bundle cannot import the in-box module (client bundle
		* purity gate: cross-plugin value imports are forbidden), so the model lives
		* here with one adaptation: this card's fields live under the `vl` sub-section
		* of the `llm-vl-gateway` namespace, so writes are path-addressed through
		* `api.settings.mutate` (the client `SettingsScope.set` addresses only
		* root-level scalar fields).
		*
		* @module dsh-deepseek-vision/client/form
		*/
		/** Read one scalar along a settings path, or undefined. */
		function atPath(value, path) {
			let node = value;
			for (const segment of path) {
				if (typeof node !== "object" || node === null) return void 0;
				node = node[segment];
			}
			return node;
		}
		/** A free-text field; an empty draft clears the field. */
		function textField(field, path) {
			return {
				field,
				path,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : {
						kind: "set",
						value: trimmed
					};
				}
			};
		}
		/** A whole-number field; an empty draft clears, any other non-finite draft blocks the save. */
		function numberField(field, path) {
			return {
				field,
				path,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					return Number.isFinite(parsed) ? {
						kind: "set",
						value: parsed
					} : void 0;
				}
			};
		}
		/** A fixed-choice field; a draft outside the choice set blocks the save. */
		function choiceField(field, path, choices) {
			return {
				field,
				path,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					return choices.includes(trimmed) ? {
						kind: "set",
						value: trimmed
					} : void 0;
				}
			};
		}
		/**
		* Stages one card's edits over one settings namespace and writes them on save.
		* Field writes are path-addressed `settings.mutate` ops against the namespace;
		* the Host response is authoritative — an accepted write clears its draft, a
		* refused one keeps it so the user can correct it.
		*/
		var CardForm = class {
			scope;
			api;
			ns;
			specs = /* @__PURE__ */ new Map();
			secretSpecs = /* @__PURE__ */ new Map();
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			constructor(scope, api, ns, specs, secrets = []) {
				this.scope = scope;
				this.api = api;
				this.ns = ns;
				for (const spec of specs) this.specs.set(spec.field, spec);
				for (const spec of secrets) this.secretSpecs.set(spec.field, spec);
				scope.subscribe(() => {
					this.publish();
				});
			}
			/** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Read the card-level state: what the Host serves, and what a save would do. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			/** Read one control's state. */
			field(field) {
				const staged = this.staged.get(field);
				if (this.secretSpecs.has(field)) return {
					text: staged?.text ?? "",
					overridden: false,
					invalid: false
				};
				const spec = this.spec(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			/** Build the edit, reset, save, and discard actions bound to this form. */
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, {
							text,
							clear: false
						});
					},
					resetField: (field) => {
						this.stage(field, {
							text: this.spec(field).format(this.baseValue(field)),
							clear: true
						});
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			/**
			* Write every staged edit in staging order. The Host response is the only
			* authority on acceptance; drafts survive a refused save.
			*
			* Re-seed dependency: after the writes land, the controls re-read their
			* stored values when the Host forwards the `settings/document-updated`
			* event through the scope subscription — the path-addressed
			* `api.settings.mutate` below has no inline re-read like `SettingsScope.set`
			* does. The forwarded event lands in the same Host settlement, so the
			* re-seed is a same-tick refresh, not a poll.
			*/
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			/** Every staged edit a save would write, in staging order. */
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const secret = this.secretSpecs.get(field);
					if (secret !== void 0) {
						const value = staged.text.trim();
						if (value !== "") plan.push({
							field,
							run: () => secret.write(value)
						});
						continue;
					}
					const spec = this.spec(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({
							field,
							run: () => this.clear(spec)
						});
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({
						field,
						run: void 0
					});
					else if (write.kind === "clear") plan.push({
						field,
						run: () => this.clear(spec)
					});
					else plan.push({
						field,
						run: () => this.write(spec, write.value)
					});
				}
				return plan;
			}
			/** Path-addressed set through the settings transport. */
			async write(spec, value) {
				try {
					return (await this.api.settings.mutate({
						ns: this.ns,
						ops: [{
							op: "set",
							path: [...spec.path],
							value
						}],
						...this.expectedRevision()
					})).result.ok;
				} catch {
					return false;
				}
			}
			/** Path-addressed clear, so the field re-inherits the composition layer. */
			async clear(spec) {
				try {
					return (await this.api.settings.mutate({
						ns: this.ns,
						ops: [{
							op: "unset",
							path: [...spec.path]
						}],
						...this.expectedRevision()
					})).result.ok;
				} catch {
					return false;
				}
			}
			expectedRevision() {
				const revision = this.scope.getSnapshot().revision;
				return revision === void 0 ? {} : { expectedRevision: revision };
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
			}
			spec(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`plugin card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return atPath(this.snapshotOf().value, this.spec(field).path);
			}
			baseValue(field) {
				return atPath(this.snapshotOf().base, this.spec(field).path);
			}
			/** Presence in the raw user layer — not a value comparison — marks an override. */
			stored(field) {
				return atPath(this.snapshotOf().user, this.spec(field).path) !== void 0;
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region lib/client/controller.js
		/**
		* The VL gateway card's staged form over the `llm-vl-gateway` settings
		* namespace. All fields live under the namespace's `vl` sub-section; the key
		* is the one control that does not live in the section — its literal never
		* rides a response, so the card learns only whether one is configured and
		* writes it through the credentials domain, addressed by the reference the
		* section names.
		*
		* Namespace and section shape are spelled here rather than imported: a client
		* package must not depend on a Host package (client bundle purity gate).
		*
		* @module dsh-deepseek-vision/client/controller
		*/
		/** Host settings namespace the gateway plugin owns. */
		const GATEWAY_SETTINGS_NS = "llm-vl-gateway";
		/** Credential reference the gateway resolves when the section names none. */
		const DEFAULT_VL_API_KEY_REF = "QWEN_VL_API_KEY";
		/** Form field the credential control stages under. */
		const API_KEY_FIELD = "apiKey";
		/** Bridges the `llm-vl-gateway` scope and the credentials domain onto the card. */
		var VlGatewayCardController = class {
			scope;
			api;
			form;
			store;
			credential = {
				ref: "",
				configured: false,
				writable: true
			};
			/**
			* @param scope - the bound settings scope for the `llm-vl-gateway` namespace.
			* @param api - wire face used for path-addressed settings writes and the credential.
			*/
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.form = new CardForm(scope, api, GATEWAY_SETTINGS_NS, [
					textField("apiKeyEnv", ["vl", "apiKeyEnv"]),
					textField("baseURL", ["vl", "baseURL"]),
					textField("model", ["vl", "model"]),
					textField("describePrompt", ["vl", "describePrompt"]),
					numberField("timeoutMs", ["vl", "timeoutMs"]),
					numberField("maxCacheEntries", ["vl", "maxCacheEntries"]),
					choiceField("onFailure", ["vl", "onFailure"], ["fail", "placeholder"])
				], [{
					field: API_KEY_FIELD,
					write: (text) => this.writeKey(text)
				}]);
				this.store = this.form.bind(() => this.projection());
				scope.subscribe(() => {
					this.readCredential();
				});
				this.readCredential();
			}
			projection() {
				return {
					...this.form.shell(),
					apiKeyEnv: this.form.field("apiKeyEnv"),
					baseURL: this.form.field("baseURL"),
					model: this.form.field("model"),
					describePrompt: this.form.field("describePrompt"),
					timeoutMs: this.form.field("timeoutMs"),
					maxCacheEntries: this.form.field("maxCacheEntries"),
					onFailure: this.form.field("onFailure"),
					apiKey: this.form.field(API_KEY_FIELD),
					apiKeyConfigured: this.credential.configured,
					apiKeyWritable: this.credential.writable
				};
			}
			/**
			* Ask the credentials domain about the reference the section currently
			* names. A response is published only while it still answers for the
			* reference in force.
			*/
			async readCredential() {
				const ref = refOf(this.scope.getSnapshot());
				if (ref !== this.credential.ref) {
					this.credential = {
						ref,
						configured: false,
						writable: true
					};
					this.store.set(this.projection());
				}
				try {
					const response = await this.api.credentials.describe({ refs: [ref] });
					if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return;
					const view = response.result.value.credentials[ref];
					const next = {
						ref,
						configured: view?.configured ?? false,
						writable: view?.writable ?? true
					};
					if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
					this.credential = next;
					this.store.set(this.projection());
				} catch {}
			}
			/** Re-read after the Host reports a change to the reference this card watches. */
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			/** Build the face the card's slot registration injects. */
			inject() {
				return {
					hooks: { vlGatewayCard: this.store },
					...this.form.actions()
				};
			}
			/** Write the staged key, then re-read whether the Host now holds one. */
			async writeKey(value) {
				try {
					await this.api.credentials.set({
						ref: refOf(this.scope.getSnapshot()),
						value
					});
				} catch {}
				await this.readCredential();
				return this.credential.configured;
			}
		};
		/** The credential reference the section names, or the gateway default. */
		function refOf(snapshot) {
			const declared = snapshot.value?.vl?.apiKeyEnv;
			return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_VL_API_KEY_REF;
		}
		//#endregion
		//#region lib/client/locales.js
		/**
		* Dictionary namespace owned by the VL gateway client plugin. The merge into
		* `LocaleNamespaceMap` is what types `PropsLocale<'vl-gateway'>` and
		* `ctx.locale.bind(NS)`.
		*
		* @module dsh-deepseek-vision/client/locales
		*/
		const NS = "vl-gateway";
		const zh = {
			title: "DeepSeek + Vision（视觉语言桥接）",
			description: "贴图后由这里的 VL 模型转成文字再发给 DeepSeek。留空即继承默认值。",
			apiKey: "VL 模型密钥",
			apiKeyHint: "写入凭据存储，绝不出现在响应或设置里；留空不写。",
			apiKeySet: "已配置",
			apiKeyUnset: "未配置",
			apiKeyEnv: "密钥引用名",
			apiKeyEnvHint: "凭据/环境变量的名字，默认 QWEN_VL_API_KEY。",
			baseURL: "VL 端点",
			baseURLHint: "OpenAI 兼容网关，/chat/completions 会自动追加。默认 DashScope 兼容模式。",
			model: "VL 模型",
			modelHint: "端点接受的模型 id，默认 qwen3-vl-flash。",
			describePrompt: "描述提示词",
			describePromptHint: "发给 VL 模型的描述指令；逐字提取代码、报错、日志、UI 文案等。",
			timeoutMs: "超时（毫秒）",
			timeoutMsHint: "单次描述请求的硬超时，默认 120000。",
			maxCacheEntries: "缓存条数",
			maxCacheEntriesHint: "进程内按图片去重的描述缓存容量，默认 64。",
			onFailure: "失败策略",
			onFailureHint: "fail=描述失败整个请求失败；placeholder=降级为文字占位继续。",
			overridden: "已覆盖",
			reset: "重置",
			invalidNumber: "无效数字",
			invalidChoice: "无效选项",
			save: "保存",
			discard: "放弃修改",
			saving: "保存中…",
			saveFailed: "保存未全部生效"
		};
		const en = {
			title: "DeepSeek + Vision (vision-language bridge)",
			description: "Pasted images are described by this VL model before DeepSeek sees the text. Empty fields inherit the defaults.",
			apiKey: "VL model API key",
			apiKeyHint: "Written to the credential store; never appears in responses or settings. Leave blank to keep unchanged.",
			apiKeySet: "configured",
			apiKeyUnset: "not configured",
			apiKeyEnv: "Credential reference",
			apiKeyEnvHint: "Name of the credential/environment variable; defaults to QWEN_VL_API_KEY.",
			baseURL: "VL endpoint",
			baseURLHint: "Any OpenAI-compatible gateway; /chat/completions is appended. Defaults to the DashScope compatible endpoint.",
			model: "VL model",
			modelHint: "Model id the endpoint accepts; defaults to qwen3-vl-flash.",
			describePrompt: "Description prompt",
			describePromptHint: "Instruction sent with each image; ask for verbatim extraction of code, errors, logs, and UI text.",
			timeoutMs: "Timeout (ms)",
			timeoutMsHint: "Hard cap on one description request; defaults to 120000.",
			maxCacheEntries: "Cache entries",
			maxCacheEntriesHint: "Per-image in-process description cache capacity; defaults to 64.",
			onFailure: "Failure policy",
			onFailureHint: "fail: the whole request fails. placeholder: substitute an error note and continue.",
			overridden: "overridden",
			reset: "reset",
			invalidNumber: "invalid number",
			invalidChoice: "invalid choice",
			save: "Save",
			discard: "Discard",
			saving: "Saving…",
			saveFailed: "Save did not fully land"
		};
		//#endregion
		//#region lib/client/index.js
		/**
		* Client plugin half of dsh-deepseek-vision: registers one config card into the
		* Plugins → plugin-config section (slot `settings.plugin.item`) so the
		* `llm-vl-gateway.vl` section — endpoint, model, prompt, and the VL key — is
		* editable from the web GUI exactly like the in-box plugin cards.
		*
		* Cross-plugin collaboration goes through cordis services only (client bundle
		* purity gate): settingsScope for the section, connection's api for
		* path-addressed settings writes and the credential domain, locale for copy,
		* and the slots registry for the card contribution.
		*
		* @module dsh-deepseek-vision/client
		*/
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];
		const STYLES = `
.vlgt-card { padding: 12px 16px 16px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 8px; }
.vlgt-head { margin-bottom: 10px; }
.vlgt-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.vlgt-description { margin: 0; font-size: 12px; opacity: .75; }
.vlgt-field { margin: 10px 0; }
.vlgt-field-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.vlgt-label { font-size: 12px; font-weight: 500; }
.vlgt-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--dsh-accent, rgba(64,128,255,.18)); }
.vlgt-reset { margin-left: auto; font-size: 11px; border: 0; background: transparent; cursor: pointer; opacity: .7; }
.vlgt-reset:disabled { opacity: .3; cursor: default; }
.vlgt-input { width: 100%; box-sizing: border-box; padding: 6px 8px; font: inherit; font-size: 13px; border-radius: 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); background: transparent; color: inherit; }
.vlgt-hint { margin-top: 3px; font-size: 11px; opacity: .65; }
.vlgt-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.vlgt-failed { font-size: 11px; color: var(--dsh-danger, #e5484d); }
.vlgt-button { padding: 5px 12px; font: inherit; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); background: transparent; color: inherit; cursor: pointer; }
.vlgt-button:disabled { opacity: .4; cursor: default; }
.vlgt-button-primary { background: var(--dsh-accent, rgba(64,128,255,.85)); border-color: transparent; color: #fff; }
`;
		/** Inject the card's scoped stylesheet; removed when the plugin unloads. */
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			const id = "dsh-deepseek-vision-styles";
			if (document.getElementById(id) !== null) return () => {};
			const tag = document.createElement("style");
			tag.id = id;
			tag.dataset.plugin = "dsh-deepseek-vision";
			tag.textContent = STYLES;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		/**
		* Mount the VL gateway config card.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const { api } = ctx.get("connection");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "vl-gateway: card dictionaries");
			const removeStyles = injectStyles();
			ctx.effect(() => removeStyles, "vl-gateway: card styles");
			const controller = new VlGatewayCardController(ctx.settingsScope.bind({ namespace: "llm-vl-gateway" }), api);
			ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => {
				controller.refreshCredential(ref);
			}), "vl-gateway: credential invalidations");
			const cardEntry = {
				name: "settings.plugin.item",
				key: GATEWAY_SETTINGS_NS,
				id: "vl-gateway",
				order: 30,
				locale: NS,
				inject: () => controller.inject()
			};
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register(cardEntry, VlGatewayCard);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map