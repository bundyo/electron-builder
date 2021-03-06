import { InfoRetriever, ProjectMetadataProvider } from "./repositoryInfo"
import { AppMetadata, DevMetadata, Platform, PlatformSpecificBuildOptions, getProductName } from "./metadata"
import EventEmitter = NodeJS.EventEmitter
import { Promise as BluebirdPromise } from "bluebird"
import * as path from "path"
import packager = require("electron-packager-tf")
import globby = require("globby")
import { copy } from "fs-extra-p"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

const pack = BluebirdPromise.promisify(packager)

export interface PackagerOptions {
  arch?: string

  dist?: boolean
  githubToken?: string

  sign?: string

  platform?: Array<string>
  target?: Array<string>

  appDir?: string

  projectDir?: string

  cscLink?: string
  csaLink?: string
  cscKeyPassword?: string
}

export interface BuildInfo extends ProjectMetadataProvider {
  options: PackagerOptions

  devMetadata: DevMetadata

  projectDir: string
  appDir: string

  electronVersion: string

  repositoryInfo: InfoRetriever
  eventEmitter: EventEmitter
}

export abstract class PlatformPackager<DC extends PlatformSpecificBuildOptions> implements ProjectMetadataProvider {
  protected readonly options: PackagerOptions

  protected readonly projectDir: string
  protected readonly buildResourcesDir: string

  readonly metadata: AppMetadata
  readonly devMetadata: DevMetadata

  customBuildOptions: DC

  readonly appName: string

  protected abstract get platform(): Platform

  constructor(protected info: BuildInfo) {
    this.options = info.options
    this.projectDir = info.projectDir
    this.metadata = info.metadata
    this.devMetadata = info.devMetadata

    this.buildResourcesDir = path.resolve(this.projectDir, this.relativeBuildResourcesDirname)

    const buildMetadata: any = info.devMetadata.build
    this.customBuildOptions = buildMetadata == null ? buildMetadata : buildMetadata[this.platform.buildConfigurationKey]

    this.appName = getProductName(this.metadata, this.devMetadata)
  }

  protected get relativeBuildResourcesDirname() {
    const directories = this.devMetadata.directories
    return (directories == null ? null : directories.buildResources) || "build"
  }

  protected dispatchArtifactCreated(file: string, artifactName?: string) {
    this.info.eventEmitter.emit("artifactCreated", {
      file: file,
      artifactName: artifactName,
      platform: this.platform,
    })
  }

  async pack(platform: string, outDir: string, appOutDir: string, arch: string): Promise<any> {
    const version = this.metadata.version
    let buildVersion = version
    const buildNumber = process.env.TRAVIS_BUILD_NUMBER || process.env.APPVEYOR_BUILD_NUMBER || process.env.CIRCLE_BUILD_NUM
    if (buildNumber != null) {
      buildVersion += "." + buildNumber
    }

    const electronPackagerOptions = this.devMetadata.build
    checkConflictingOptions(electronPackagerOptions)

    const options = Object.assign({
      dir: this.info.appDir,
      out: outDir,
      name: this.appName,
      platform: platform,
      arch: arch,
      version: this.info.electronVersion,
      icon: path.join(this.buildResourcesDir, "icon"),
      asar: true,
      overwrite: true,
      "app-version": version,
      "build-version": buildVersion,
      tmpdir: false,
      "version-string": {
        CompanyName: this.metadata.author.name,
        FileDescription: this.metadata.description,
        ProductName: this.appName,
        InternalName: this.appName,
      }
    }, electronPackagerOptions)

    delete options.osx
    delete options.win
    delete options.linux

    // this option only for windows-installer
    delete options.iconUrl
    await pack(options)

    const buildMetadata: any = this.devMetadata.build
    let extraResources: Array<string> = buildMetadata == null ? null : buildMetadata.extraResources

    const platformSpecificExtraResources = this.customBuildOptions == null ? null : this.customBuildOptions.extraResources
    if (platformSpecificExtraResources != null) {
      extraResources = extraResources == null ? platformSpecificExtraResources : extraResources.concat(platformSpecificExtraResources)
    }

    if (extraResources != null) {
      const expandedPatterns = extraResources.map(it => it
        .replace(/\$\{arch}/g, arch)
        .replace(/\$\{os}/g, this.platform.buildConfigurationKey))
      await BluebirdPromise.map(await globby(expandedPatterns, {cwd: this.projectDir}), it => {
        let resourcesDir = appOutDir
        if (platform === "darwin") {
          resourcesDir = path.join(resourcesDir, this.appName + ".app", "Contents", "Resources")
        }
        return copy(path.join(this.projectDir, it), path.join(resourcesDir, it))
      })
    }
  }

  abstract packageInDistributableFormat(outDir: string, appOutDir: string, arch: string): Promise<any>
}

function checkConflictingOptions(options: any): void {
  for (let name of ["all", "out", "tmpdir", "version", "platform", "dir", "arch"]) {
    if (name in options) {
      throw new Error(`Option ${name} is ignored, do not specify it.`)
    }
  }
}

export interface ArtifactCreated {
  readonly file: string
  readonly artifactName?: string

  readonly platform: Platform
}