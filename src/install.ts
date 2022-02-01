import axios from "axios";
import {
    createWriteStream,
    existsSync,
    promises as fsp,
    readdirSync,
} from "fs";
import { components } from "@octokit/openapi-types";
import { resolve } from "path";
import { extract } from "tar";

const { mkdir, rm, writeFile } = fsp;

type Release = components["schemas"]["release"];

function getArch() {
    switch (process.arch) {
        case "x32":
            return "386";
        case "x64":
            return "amd64";
        case "arm64":
            return "arm64";
        case "arm":
            return "armv7";
    }

    throw new Error(`architecture "${process.arch}" is not supported`);
}

function getPlatform() {
    switch (process.platform) {
        case "darwin":
            return "darwin";
        case "linux":
            return "linux";
        case "win32":
            return "windows";
    }

    throw new Error(`platform "${process.platform}" is not supported`);
}

export async function getLatestRelease(repo: string) {
    const { data } = await axios.get<Release[]>(
        `https://api.github.com/repos/${repo}/releases`
    );
    return data[0];
}

export async function getReleaseByTag(repo: string, tag: string) {
    const { data } = await axios.get<Release[]>(
        `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    );
    return data;
}

export async function downloadRelease(release: Release) {
    const arch = getArch();
    const platform = getPlatform();
    const outDir = resolve(__dirname, "../bin");

    if (existsSync(outDir)) {
        const hasGocqhttp = readdirSync(outDir).reduce((p, c) => {
            if (/go-cqhttp/.test(c)) return true;
            return p;
        }, false);

        if (hasGocqhttp) return;
    }

    const name = `go-cqhttp_${platform}_${arch}.${
        platform === "windows" ? "exe" : "tar.gz"
    }`;
    const asset = release.assets.find((asset) => asset.name === name);
    if (!asset) throw new Error(`target "${name}" is not found`);

    const mirror = process.env.GITHUB_MIRROR || "https://download.fastgit.org";

    const url = asset.browser_download_url.replace(
        "https://github.com",
        mirror
    );

    const [{ data: stream }] = await Promise.all([
        axios.get<NodeJS.ReadableStream>(url, { responseType: "stream" }),
        mkdir(outDir, { recursive: true }),
    ]);

    await Promise.all([
        writeFile(
            outDir + "/index.json",
            JSON.stringify({ ...release, assets: undefined })
        ),
        new Promise(async (resolve, reject) => {
            stream.on("end", resolve);
            stream.on("error", reject);
            if (platform === "windows") {
                stream.pipe(createWriteStream(outDir + "/go-cqhttp.exe"));
            } else {
                stream.pipe(
                    extract({ cwd: outDir, newer: true }, ["go-cqhttp"])
                );
            }
        }),
    ]).catch(() => rm(outDir, { force: true, recursive: true }));
}
