import * as fs from 'fs/promises';
import * as path from 'path';

interface DocsConfig {
    navigation: {
        tabs: Tab[];
        global?: any;
    };
}

interface Tab {
    tab: string;
    icon?: string;
    groups: Group[];
}

interface Group {
    group: string;
    pages: (string | NavigationItem)[];
}

interface NavigationItem {
    group?: string;
    pages: (string | NavigationItem)[];
}

/**
 * Recursively extracts page paths from navigation structure
 */
function extractPagePaths(items: (string | NavigationItem)[], basePath: string = ''): string[] {
    const paths: string[] = [];

    for (const item of items) {
        if (typeof item === 'string') {
            // Handle both relative and absolute paths
            const fullPath = item.startsWith('/') ? '../docs/specification' + item.slice(1) : '../docs/' + path.join(basePath, item);
            paths.push(fullPath);
        } else if (item.pages) {
            // Recursively process nested pages
            paths.push(...extractPagePaths(item.pages, basePath));
        }
    }

    return paths;
}

/**
 * Removes MDX frontmatter and returns clean content
 */
function cleanMdxContent(content: string): string {
    // Remove frontmatter (--- ... ---)
    const frontmatterRegex = /^---[\s\S]*?---\n*/;
    const cleanContent = content.replace(frontmatterRegex, '');

    // Remove any remaining leading/trailing whitespace
    return cleanContent.trim();
}

/**
 * Finds the latest specification version from docs.json navigation
 */
function findLatestSpecVersion(docsConfig: DocsConfig): string {
    const specTab = docsConfig.navigation.tabs.find(tab =>
        tab.tab.toLowerCase() === 'specification'
    );

    if (!specTab) {
        throw new Error('Specification tab not found in docs.json');
    }

    // Look for the group marked as "Latest" or find the most recent date
    for (const group of specTab.groups) {
        if (group.group.includes('Latest') || group.group.includes('2025-03-26')) {
            // Extract the date from the group name
            const dateMatch = group.group.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                return dateMatch[1];
            }
        }
    }

    // Fallback: find all date-like groups and return the latest
    const dateGroups = specTab.groups
        .map(group => {
            const match = group.group.match(/(\d{4}-\d{2}-\d{2})/);
            return match ? match[1] : null;
        })
        .filter(Boolean)
        .sort()
        .reverse();

    if (dateGroups.length > 0) {
        return dateGroups[0]!;
    }

    throw new Error('No versioned specification groups found');
}

/**
 * Gets the navigation pages for the latest specification version
 */
function getLatestSpecNavigation(docsConfig: DocsConfig): (string | NavigationItem)[] {
    const specTab = docsConfig.navigation.tabs.find(tab =>
        tab.tab.toLowerCase() === 'specification'
    );

    if (!specTab) {
        throw new Error('Specification tab not found in docs.json');
    }

    // Find the latest version group (marked with "Latest" or most recent date)
    let latestGroup: Group | null = null;

    for (const group of specTab.groups) {
        if (group.group.includes('Latest') || group.group.includes('2025-03-26')) {
            latestGroup = group;
            break;
        }
    }

    if (!latestGroup) {
        throw new Error('Latest specification group not found');
    }

    return latestGroup.pages;
}

/**
 * Reads schema files for the given version
 */
async function readSchemaFiles(version: string): Promise<{ ts: string | null; json: string | null }> {
    const schemaDir = `../schema/${version}`;
    const results = { ts: null as string | null, json: null as string | null };

    // Try to read schema.ts
    try {
        results.ts = await fs.readFile(path.join(schemaDir, 'schema.ts'), 'utf-8');
        console.log(`✓ Found schema.ts for version ${version}`);
    } catch (error) {
        console.warn(`⚠ Could not find schema.ts for version ${version}`);
    }

    // Try to read schema.json
    try {
        results.json = await fs.readFile(path.join(schemaDir, 'schema.json'), 'utf-8');
        console.log(`✓ Found schema.json for version ${version}`);
    } catch (error) {
        console.warn(`⚠ Could not find schema.json for version ${version}`);
    }

    return results;
}

/**
 * Main function to concatenate spec files
 */
async function concatenateSpec(includeFull: boolean = false): Promise<void> {
    try {
        // Read and parse docs.json
        const docsJsonPath = '../docs/docs.json';
        const docsContent = await fs.readFile(docsJsonPath, 'utf-8');
        const docsConfig: DocsConfig = JSON.parse(docsContent);

        // Find latest specification version and navigation
        const latestVersion = findLatestSpecVersion(docsConfig);
        const specNavigation = getLatestSpecNavigation(docsConfig);

        console.log(`Using specification version: ${latestVersion}`);
        console.log(`Found specification navigation with ${specNavigation.length} top-level items`);

        // Extract page paths for the specification
        const pagePaths = extractPagePaths(specNavigation);
        console.log(`Found ${pagePaths.length} specification pages`);

        // Read and concatenate files
        const concatenatedContent: string[] = [];
        let processedCount = 0;

        for (const pagePath of pagePaths) {
            // All spec files should be .mdx and directly accessible
            const possiblePaths = [
                `${pagePath}.mdx`,
                `${pagePath}.md`,
                pagePath
            ];

            let content: string | null = null;
            let usedPath: string | null = null;

            for (const possiblePath of possiblePaths) {
                try {
                    content = await fs.readFile(possiblePath, 'utf-8');
                    usedPath = possiblePath;
                    break;
                } catch (error) {
                    // Try next path
                    continue;
                }
            }

            if (content && usedPath) {
                const cleanContent = cleanMdxContent(content);
                if (cleanContent) {
                    // Use the page path as the header, removing the specification version prefix
                    const pageTitle = pagePath.replace(`specification/${latestVersion}/`, '');
                    concatenatedContent.push(`# ${pageTitle}\n\n${cleanContent}`);
                    processedCount++;
                    console.log(`✓ Processed: ${usedPath}`);
                }
            } else {
                console.warn(`⚠ Could not find file for: ${pagePath}`);
            }
        }

        // Generate base output
        const baseContent = concatenatedContent.join('\n\n---\n\n');

        // Write the basic specification file
        const baseOutputPath = `./mcp-spec.txt`;
        await fs.writeFile(baseOutputPath, baseContent, 'utf-8');

        console.log(`\n✅ Successfully concatenated ${processedCount} files`);
        console.log(`📄 Basic spec written to: ${baseOutputPath}`);
        console.log(`📊 Basic spec size: ${baseContent.length} characters`);

        // If includeFull is true, also create the full version with schema files
        if (includeFull) {
            const schemaFiles = await readSchemaFiles(latestVersion);
            const fullContent = [baseContent];

            if (schemaFiles.ts) {
                fullContent.push(`# schema.ts\n\n\`\`\`typescript\n${schemaFiles.ts}\n\`\`\``);
            }

            if (schemaFiles.json) {
                fullContent.push(`# schema.json\n\n\`\`\`json\n${schemaFiles.json}\n\`\`\``);
            }

            const fullOutputContent = fullContent.join('\n\n---\n\n');
            const fullOutputPath = `./mcp-spec-full.txt`;

            await fs.writeFile(fullOutputPath, fullOutputContent, 'utf-8');

            console.log(`📄 Full spec written to: ${fullOutputPath}`);
            console.log(`📊 Full spec size: ${fullOutputContent.length} characters`);
        }

    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    // Check command line arguments
    const args = process.argv.slice(2);
    const includeFull = args.includes('--full') || args.includes('-f');

    concatenateSpec(includeFull);
}

export { concatenateSpec };
