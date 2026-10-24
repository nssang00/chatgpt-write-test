from setuptools import find_packages, setup

package_name = "cito_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Cito",
    maintainer_email="none@example.invalid",
    description="Experimental ROS 2 Jazzy to Cito topic bridge; not rmw_cito",
    license="Apache-2.0",
    entry_points={"console_scripts": ["cito_ros_bridge = cito_bridge.bridge:main"]},
)
