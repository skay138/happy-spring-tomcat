/** Full-webapp deployment only. Ordinary Gradle debugging runs the standard classes task. */
export const gradlePreparationScript = `gradle.projectsEvaluated {
    def current = gradle.startParameter.currentDir.canonicalFile
    def p = gradle.rootProject.allprojects.find { it.projectDir.canonicalFile == current }
    def warTask = p?.tasks?.findByName('war')
    if (warTask == null) throw new GradleException('Open the web application module with the war plugin, or use a custom VS Code task.')
    def main = p.extensions.findByName('sourceSets').getByName('main')
    def target = new File(p.property('happyTomcatWebApp').toString()).canonicalFile
    def build = p.layout.buildDirectory.get().asFile.canonicalFile
    def archive = warTask.archiveFile.get().asFile.canonicalFile
    def contains = { File parent, File child -> child.toPath().startsWith(parent.toPath()) }
    // Sync removes obsolete destination files: never allow it to erase build inputs or other outputs.
    if (target == build || !contains(build, target) || contains(target, archive) ||
        main.output.files.any { contains(target, it.canonicalFile) || contains(it.canonicalFile, target) } ||
        main.allSource.srcDirs.any { contains(target, it.canonicalFile) || contains(it.canonicalFile, target) }) {
        throw new GradleException('Built Web App Directory must be a separate folder under the Gradle build directory, such as build/exploded.')
    }
    def preparation = p.tasks.create('happyTomcatPrepare', Sync)
    preparation.dependsOn(warTask)
    preparation.from { p.zipTree(warTask.archiveFile.get().asFile) }
    preparation.into(target)
}
`;
