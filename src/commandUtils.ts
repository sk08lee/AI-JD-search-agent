import fs from "fs";
import { execSync } from "child_process";

export function resolveUvxCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    const command = env.UVX_COMMAND?.trim() || "uvx";
    return normalizeCommandForPlatform(command, platform);
}

export function commandExists(command: string, platform: NodeJS.Platform = process.platform): boolean {
    const normalizedCommand = normalizeCommandForPlatform(command, platform);
    if (!normalizedCommand.trim()) return false;

    if (looksLikePath(normalizedCommand)) {
        return fs.existsSync(normalizedCommand);
    }

    try {
        const lookup = platform === "win32" ? `where ${quoteShellArg(normalizedCommand)}` : `command -v ${quoteShellArg(normalizedCommand)}`;
        execSync(lookup, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function looksLikePath(command: string): boolean {
    return command.includes("/") || command.includes("\\");
}

function normalizeCommandForPlatform(command: string, platform: NodeJS.Platform): string {
    if (platform !== "win32") return command;

    const wslMountMatch = command.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
    if (!wslMountMatch) return command;

    const [, drive, rest] = wslMountMatch;
    return `${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
}

function quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
