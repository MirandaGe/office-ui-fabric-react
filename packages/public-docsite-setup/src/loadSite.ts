//
// When imported, this file will load the code for the public website and set up `window.__versionSwitcherDefinition`.
// It is NOT exported from the package and should ONLY be referenced via the webpack helper under
// @fluentui/public-docsite-setup/scripts/getLoadSiteConfig.js.
//
// On the local and PR deploy sites, it uses `process.env.LOCAL_LIBRARY_VERSION` defined by the webpack
// helper to determine the current version of the main library (@fluentui/react or office-ui-fabric-react)
// and loads the served or deployed files specific to that local build or PR.
//
// On the real site, it loads a manifest file for the specified or latest major version and
// uses that to determine which files to load for the rest of the site.
//
import { BUNDLE_NAME, MANIFEST_NAME_FORMAT } from './constants';
import { SiteGlobals, ManifestVariant } from './types';

declare const window: Window & SiteGlobals;

const fabricVer = 'fabricVer';

const versions = [
  { name: 'Fluent UI React', major: '8' },
  { name: 'Fluent UI React', major: '7' },
  { name: 'Fabric React', major: '6' },
  { name: 'Fabric React', major: '5' },
];
const majorVersions = versions.map(v => v.major);

type SiteVariant = ManifestVariant | 'local' | 'prDeploy';

const prod: ManifestVariant = 'prod';
const df: ManifestVariant = 'df';

/** All known hostnames the website can be run against */
const expectedHosts = {
  // redundant !! is to ensure the correct inferred type of expectedHosts
  ...(!!process.env.LOCAL && {
    local: ['localhost', '[::]', '127.0.0.1'],
    prDeploy: ['fluentuipr.z22.web.core.windows.net'],
  }),
  // NOTE: "df" and "prod" must match the suffixes used on the files generated by create-site-manifests
  // (the typed constants help ensure this stays in sync)
  [df]: ['developer.microsoft-tst.com', 'uifabric-tst.azurewebsites.net'],
  [prod]: ['developer.microsoft.com', 'uifabric-prod.azurewebsites.net'],
};

// Call the entry point
loadSite();

function loadSite() {
  const isDev = getParameterByName('dev') === '1' || !!getParameterByName('strict');
  const isProduction =
    !process.env.LOCAL || getParameterByName('prod') === '1' || getParameterByName('isProduction') === '1';
  const siteVariant = getSiteVariant();

  if (process.env.LOCAL && (siteVariant === 'prDeploy' || siteVariant === 'local' || !siteVariant)) {
    // Load the PR deployed site or locally served site.
    // (Also default to this for unknown hosts.)
    if (!siteVariant) {
      console.warn(
        `Attempting to load local version of site for unknown host "${location.hostname}".`,
        `You may want to add this to expectedHosts in @fluentui/public-docsite-setup/src/loadSite.ts.`,
      );
    }

    if (!process.env.LOCAL_LIBRARY_VERSION) {
      throw new Error('LOCAL_LIBRARY_VERSION must be specified for PR deploy or locally served site');
    }

    loadSiteInternal({
      baseUrl:
        siteVariant === 'prDeploy'
          ? location.origin + location.pathname.replace('index.html', '')
          : location.origin + '/',
      isDemo: true,
      // filled in by webpack DefinePlugin
      libraryVersion: process.env.LOCAL_LIBRARY_VERSION,
      // default to loading dev build unless explicitly requested otherwise
      useMinified: isProduction,
    });
  } else if (siteVariant === prod || siteVariant === df) {
    // Load the real site (default to the most recent version). Note: the custom version logic is
    // only for the real site since PR deploy and local serve are tied to a specific version.
    let majorVersion = majorVersions[0];
    const versionFromUrl = getParameterByName(fabricVer);
    const versionFromStorage = sessionStorage.getItem(fabricVer);

    if (versionFromUrl && majorVersions.indexOf(versionFromUrl) !== -1) {
      majorVersion = versionFromUrl;
      sessionStorage.setItem(fabricVer, versionFromUrl);
    } else if (versionFromStorage && majorVersions.indexOf(versionFromStorage) !== -1) {
      majorVersion = versionFromStorage;
    }

    // NOTE: This filename must match what's generated by create-site-manifests.js.
    // siteVariant should be "df" or "prod" depending on domain.
    const manifestName = MANIFEST_NAME_FORMAT.replace('{major}', majorVersion).replace('{suffix}', siteVariant);
    const manifestUrl = `https://fabricweb.azureedge.net/fabric-website/manifests/${manifestName}`;

    loadScript(manifestUrl, () => {
      const config = window.__siteConfig;
      if (config) {
        loadSiteInternal({
          baseUrl: config.baseCDNUrl,
          libraryVersion: config.libraryVersion,
          // default to loading production (minified) build unless explicitly requested otherwise
          useMinified: !isDev,
        });
      }
    });
  } else {
    // very much not expected, indicates something got out of sync
    throw new Error('Unexpected site variant: ' + siteVariant);
  }
}

function getSiteVariant(): SiteVariant | undefined {
  const hostname = location.hostname;
  const variants = Object.keys(expectedHosts) as (keyof typeof expectedHosts)[];
  for (const variant of variants) {
    if (expectedHosts[variant]!.indexOf(hostname) !== -1) {
      return variant;
    }
  }
  return undefined;
}

function loadSiteInternal(options: {
  /** Base CDN or local URL to load site files from (with trailing slash) */
  baseUrl: string;
  /** Full library version, such as "8.3.2" */
  libraryVersion: string;
  /** Whether to load the minified (production) build */
  useMinified: boolean;
  /** Whether this is a demo site (local or PR deploy) */
  isDemo?: boolean;
}) {
  const { baseUrl, libraryVersion, useMinified, isDemo } = options;

  const majorVersionMatch = libraryVersion.match(/^\d+/);
  const selectedVersion = versions.filter(v => v.major === majorVersionMatch?.[0])[0];
  if (!selectedVersion) {
    throw new Error(`Invalid library version: ${libraryVersion}`);
  }

  // Set up the version switcher definition to be used later
  window.__versionSwitcherDefinition = {
    selectedMajor: selectedVersion.major,
    selectedMajorName: `${selectedVersion.name} ${libraryVersion}`,
    versions: versions.map(({ name, major }) => ({
      key: major,
      text: `${name} ${major}`,
      // These menu items are also used in v5, where the "text" prop is called "name"
      name: `${name} ${major}`,
      onClick: () => {
        if (selectedVersion.major === major) {
          return;
        }

        const url = window.location.href;
        const versionParam = `${fabricVer}=${major}`;
        let newUrl: string;
        if (getParameterByName(fabricVer)) {
          // Replace existing fabricVer param
          newUrl = url.replace(new RegExp(`\\b${fabricVer}=(\\d+)`), versionParam);
        } else if (url.indexOf('?') !== -1) {
          // Add param to existing query. (Note: not checking location.search directly since our hash-based
          // URLs sometimes put the query after the hash.)
          newUrl = url.replace('?', `?${versionParam}&`);
        } else {
          // Add a query before the hash
          const hash = location.hash;
          newUrl = `${url.replace(hash, '')}?${versionParam}${hash}`;
        }

        if (process.env.LOCAL && isDemo) {
          // Demo sites only work with the specific version they were created against, so show
          // an alert (including the new URL to help with debugging) but don't switch
          // eslint-disable-next-line no-alert
          alert(`Demo sites can't switch versions. New URL if switching versions would be: ${newUrl}`);
        } else {
          location.href = newUrl;
        }
      },
    })),
  };

  // This is used by the example editor in 7+ (but having it defined in 5-6 is harmless)
  window.MonacoConfig = {
    baseUrl: baseUrl,
    useMinified,
    crossDomain: true,
  };

  // TODO: determine if this is needed
  // window.__webpack_public_path__ = baseUrl;

  // Load the actual site
  const scriptUrl = `${baseUrl}${BUNDLE_NAME}${useMinified ? '.min.js' : '.js'}`;
  loadScript(
    scriptUrl,
    /* onLoad */ undefined,
    /* onError */ () => {
      // If requested version of the site (.js or .min.js) didn't exist, try the other version
      const newUseMinified = !useMinified;
      console.log(`${scriptUrl} does not exist; trying ${newUseMinified ? 'minified' : 'unminified'} version instead`);
      window.MonacoConfig!.useMinified = newUseMinified;
      loadScript(scriptUrl.replace(/(\.min)?\.js$/, newUseMinified ? '.min.js' : '.js'));
    },
  );
}

function getParameterByName(name: string) {
  name = name.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
  const results = regex.exec(location.href);
  return !results ? undefined : !results[2] ? '' : decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function loadScript(src: string, onLoad?: () => void, onError?: () => void) {
  const script = document.createElement('script');
  script.src = src;
  script.onload = onLoad || null;
  script.onerror = onError || null;

  document.head.appendChild(script);
}
