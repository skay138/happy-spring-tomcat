import java.io.File;
import java.net.URL;
import java.util.Collections;
import java.util.List;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;

/** Uses an isolated application and an ephemeral loopback port; no project application is started. */
public class ResourceMappingProbe {
    public static void main(String[] args) throws Exception {
        Tomcat tomcat = new Tomcat();
        tomcat.setBaseDir(args[0]);
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        Context context = tomcat.addWebapp("", args[1]);
        context.setConfigFile(new File(args[2]).toURI().toURL());
        try {
            tomcat.start();
            if (!context.getState().isAvailable()) throw new AssertionError("Context failed to start");
            ClassLoader loader = context.getLoader().getClassLoader();
            for (String resource : new String[] {
                "lucy-xss-servlet-filter-rule.xml", "egovframework/spring/com/context-security.xml"
            }) {
                List<URL> urls = Collections.list(loader.getResources(resource));
                if (urls.size() != 1) throw new AssertionError(resource + ": " + urls);
                String expected = args.length > 3 ? args[3] : "/target/classes/";
                if (!urls.get(0).toString().contains(expected)) throw new AssertionError("Wrong compiler output: " + urls);
            }
            loader.loadClass("DependencyMarker");
            if (!context.getResources().getResource("/index.txt").exists()) throw new AssertionError("Missing source web resource");
            System.out.println("RESOURCE_MAPPING_OK");
        } finally {
            tomcat.stop();
            tomcat.destroy();
        }
    }
}
