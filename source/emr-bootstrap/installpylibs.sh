#!/bin/bash
sudo yum install -y python3-devel
sudo yum install -y libtiff-devel libjpeg-devel libzip-devel freetype-devel lcms2-devel libwebp-devel tcl-devel tk-devel

#install python modules
sudo /usr/bin/python3 -m pip install -U cython==0.29.24
sudo /usr/bin/python3 -m pip install -U setuptools==58.1.0
sudo /usr/bin/python3 -m pip install -U numpy==1.21.2 
sudo /usr/bin/python3 -m pip install -U matplotlib==3.4.3
sudo /usr/bin/python3 -m pip install -U requests==2.26.0 
sudo /usr/bin/python3 -m pip install -U boto3==1.18.63 
sudo /usr/bin/python3 -m pip install -U pandas==1.2.5 

# required to parse useragent
sudo /usr/bin/python3 -m pip install -U woothee==1.10.1
# remaining for mleap
sudo /usr/bin/python3 -m pip install -U pybind11
sudo /usr/bin/python3 -m pip install -U pythran
sudo /usr/bin/python3 -m pip install -U scipy
sudo /usr/bin/python3 -m pip install -U mleap==0.17


# intall mleap on Master node
if grep isMaster /mnt/var/lib/info/instance.json | grep false;
then        
    echo "This is not master node, do nothing,exiting"
    exit 0
fi
echo "This is master, continuing to execute script"


