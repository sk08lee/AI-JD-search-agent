import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandExists, resolveUvxCommand } from "../src/commandUtils";

describe("command utils", () => {
    it("uses UVX_COMMAND when provided", () => {
        assert.equal(resolveUvxCommand({ UVX_COMMAND: "/custom/bin/uvx" }), "/custom/bin/uvx");
    });

    it("falls back to uvx when UVX_COMMAND is empty", () => {
        assert.equal(resolveUvxCommand({ UVX_COMMAND: "" }), "uvx");
    });

    it("converts WSL mount paths for Windows Node runtimes", () => {
        assert.equal(
            resolveUvxCommand({ UVX_COMMAND: "/mnt/d/Python38/Scripts/uvx.exe" }, "win32"),
            "D:\\Python38\\Scripts\\uvx.exe"
        );
    });

    it("treats existing absolute command paths as available", () => {
        assert.equal(commandExists("/mnt/d/Python38/Scripts/uvx.exe"), true);
    });
});
